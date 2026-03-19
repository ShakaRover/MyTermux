/**
 * 认证管理器
 *
 * 管理 daemon 的 Access Token 和已认证客户端，处理密钥存储
 * Token 模式：daemon 启动时生成 Access Token，客户端使用 Token 连接
 */

import { EventEmitter } from 'events';
import { mkdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import type { KeyPair } from '@mytermux/shared';
import {
  generateAccessToken,
  generateKeyPair,
  deriveSharedSecret,
} from '@mytermux/shared';

/** 已认证的客户端信息 */
export interface AuthenticatedClient {
  /** 客户端设备 ID */
  clientId: string;
  /** 客户端公钥 */
  publicKey: string;
  /** 认证时间戳 */
  authenticatedAt: number;
  /** 设备名称 */
  name?: string;
}

/** 持久化的认证数据 */
interface AuthData {
  /** Daemon 设备 ID */
  deviceId: string;
  /** 标准命名：MYTERMUX_DAEMON_TOKEN（客户端使用此 Token 连接） */
  daemonToken: string;
  /** 本地公钥 */
  publicKey: string;
  /** 本地私钥（导出格式） */
  privateKeyJwk: JsonWebKey;
  /** 已认证的客户端列表 */
  authenticatedClients: AuthenticatedClient[];
}

/** 认证管理器事件 */
export interface AuthManagerEvents {
  /** Token 已生成 */
  tokenGenerated: (token: string) => void;
  /** 客户端认证成功 */
  clientAuthenticated: (client: AuthenticatedClient) => void;
}

/** 配置文件目录 */
const CONFIG_DIR = path.join(os.homedir(), '.mytermux');
/** Daemon 数据库 */
const DAEMON_DB_FILE = path.join(CONFIG_DIR, 'daemon.db');
/** 旧版认证数据文件（仅迁移读取） */
const LEGACY_AUTH_DATA_FILE = path.join(CONFIG_DIR, 'auth.json');
/** daemon 设置项：relay 链路 token */
const DAEMON_LINK_TOKEN_KEY = 'daemon_link_token';

function createErrno(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function generateDeviceId(): string {
  const array = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function parseAuthenticatedClients(raw: unknown): AuthenticatedClient[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized: AuthenticatedClient[] = [];
  for (const item of raw) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as Record<string, unknown>)['clientId'] !== 'string' ||
      typeof (item as Record<string, unknown>)['publicKey'] !== 'string' ||
      typeof (item as Record<string, unknown>)['authenticatedAt'] !== 'number'
    ) {
      continue;
    }

    const client = item as Record<string, unknown>;
    const name = typeof client['name'] === 'string' ? client['name'] : undefined;
    normalized.push({
      clientId: String(client['clientId']),
      publicKey: String(client['publicKey']),
      authenticatedAt: Number(client['authenticatedAt']),
      ...(name ? { name } : {}),
    });
  }

  return normalized;
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daemon_auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      device_id TEXT NOT NULL,
      daemon_token TEXT NOT NULL,
      public_key TEXT NOT NULL,
      private_key_jwk TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS authenticated_clients (
      client_id TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      authenticated_at INTEGER NOT NULL,
      name TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daemon_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

function openDaemonDb(): DatabaseSync {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const db = new DatabaseSync(DAEMON_DB_FILE);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  ensureSchema(db);
  return db;
}

async function migrateLegacyAuthJsonIfNeeded(db: DatabaseSync): Promise<boolean> {
  const existing = db.prepare(`
    SELECT daemon_token
    FROM daemon_auth
    WHERE id = 1
    LIMIT 1
  `).get() as { daemon_token: string } | undefined;
  if (existing?.daemon_token) {
    return false;
  }

  let content: string;
  try {
    content = await fs.readFile(LEGACY_AUTH_DATA_FILE, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  const raw = JSON.parse(content) as Record<string, unknown>;
  const daemonToken = typeof raw.daemonToken === 'string'
    ? raw.daemonToken
    : (typeof raw.accessToken === 'string' ? raw.accessToken : generateAccessToken());
  const deviceId = typeof raw.deviceId === 'string' && raw.deviceId
    ? raw.deviceId
    : generateDeviceId();
  const publicKey = typeof raw.publicKey === 'string' ? raw.publicKey : '';
  const privateKeyJwk = raw.privateKeyJwk;
  if (!publicKey || typeof privateKeyJwk !== 'object' || privateKeyJwk === null) {
    return false;
  }

  const clients = parseAuthenticatedClients(raw.authenticatedClients);
  const now = Date.now();

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO daemon_auth (id, device_id, daemon_token, public_key, private_key_jwk, updated_at)
      VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        device_id = excluded.device_id,
        daemon_token = excluded.daemon_token,
        public_key = excluded.public_key,
        private_key_jwk = excluded.private_key_jwk,
        updated_at = excluded.updated_at
    `).run(deviceId, daemonToken, publicKey, JSON.stringify(privateKeyJwk), now);

    db.prepare('DELETE FROM authenticated_clients').run();
    const insertClient = db.prepare(`
      INSERT INTO authenticated_clients (client_id, public_key, authenticated_at, name, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(client_id) DO UPDATE SET
        public_key = excluded.public_key,
        authenticated_at = excluded.authenticated_at,
        name = excluded.name,
        updated_at = excluded.updated_at
    `);

    for (const client of clients) {
      insertClient.run(
        client.clientId,
        client.publicKey,
        client.authenticatedAt,
        client.name ?? null,
        now,
      );
    }

    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * I12: 读取并返回 Access Token（供 CLI token 命令使用）
 *
 * @returns { token, migrated } token 为 Access Token，migrated 表示是否进行了旧版数据迁移
 * @throws 数据不存在时抛出 ENOENT 错误
 */
export async function readAccessToken(): Promise<{ token: string; migrated: boolean }> {
  const db = openDaemonDb();
  try {
    let migrated = false;
    let row = db.prepare(`
      SELECT daemon_token
      FROM daemon_auth
      WHERE id = 1
      LIMIT 1
    `).get() as { daemon_token: string } | undefined;

    if (!row) {
      migrated = await migrateLegacyAuthJsonIfNeeded(db);
      row = db.prepare(`
        SELECT daemon_token
        FROM daemon_auth
        WHERE id = 1
        LIMIT 1
      `).get() as { daemon_token: string } | undefined;
    }

    if (!row?.daemon_token) {
      throw createErrno('ENOENT', '认证数据不存在，请先启动 daemon');
    }

    return { token: row.daemon_token, migrated };
  } finally {
    db.close();
  }
}

/**
 * 重置 Access Token（会清空已认证客户端）
 *
 * @returns { token, migrated } token 为重置后的 Access Token，migrated 表示是否进行了旧版数据迁移
 * @throws 数据不存在时抛出 ENOENT 错误
 */
export async function resetAccessToken(): Promise<{ token: string; migrated: boolean }> {
  const db = openDaemonDb();
  try {
    let migrated = false;
    let row = db.prepare(`
      SELECT id
      FROM daemon_auth
      WHERE id = 1
      LIMIT 1
    `).get() as { id: number } | undefined;

    if (!row) {
      migrated = await migrateLegacyAuthJsonIfNeeded(db);
      row = db.prepare(`
        SELECT id
        FROM daemon_auth
        WHERE id = 1
        LIMIT 1
      `).get() as { id: number } | undefined;
    }

    if (!row) {
      throw createErrno('ENOENT', '认证数据不存在，请先启动 daemon');
    }

    const token = generateAccessToken();
    const now = Date.now();

    db.exec('BEGIN');
    try {
      db.prepare(`
        UPDATE daemon_auth
        SET daemon_token = ?, updated_at = ?
        WHERE id = 1
      `).run(token, now);
      db.prepare('DELETE FROM authenticated_clients').run();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return { token, migrated };
  } finally {
    db.close();
  }
}

/**
 * 读取 daemon -> Relay 链路 token（MYTERMUX_DAEMON_LINK_TOKEN）
 */
export async function readDaemonLinkToken(): Promise<string | null> {
  const db = openDaemonDb();
  try {
    const row = db.prepare(`
      SELECT value
      FROM daemon_settings
      WHERE key = ?
      LIMIT 1
    `).get(DAEMON_LINK_TOKEN_KEY) as { value: string } | undefined;
    if (!row?.value) {
      return null;
    }
    const token = row.value.trim();
    return token ? token : null;
  } finally {
    db.close();
  }
}

/**
 * 写入 daemon -> Relay 链路 token（MYTERMUX_DAEMON_LINK_TOKEN）
 */
export async function setDaemonLinkToken(token: string): Promise<void> {
  const normalized = token.trim();
  if (!normalized) {
    throw new Error('token 不能为空');
  }

  const db = openDaemonDb();
  try {
    db.prepare(`
      INSERT INTO daemon_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(DAEMON_LINK_TOKEN_KEY, normalized, Date.now());
  } finally {
    db.close();
  }
}

/**
 * 清空 daemon -> Relay 链路 token
 */
export async function clearDaemonLinkToken(): Promise<void> {
  const db = openDaemonDb();
  try {
    db.prepare('DELETE FROM daemon_settings WHERE key = ?').run(DAEMON_LINK_TOKEN_KEY);
  } finally {
    db.close();
  }
}

/**
 * 认证管理器
 */
export class AuthManager extends EventEmitter {
  /** Access Token */
  private _accessToken: string = '';
  /** 本地密钥对 */
  private keyPair: KeyPair | null = null;
  /** 已认证的客户端 */
  private authenticatedClients: AuthenticatedClient[] = [];
  /** 设备 ID */
  private _deviceId: string = '';
  /** 共享密钥缓存 */
  private sharedKeyCache = new Map<string, CryptoKey>();

  constructor() {
    super();
  }

  /**
   * 初始化认证管理器
   * 加载或生成密钥对、设备 ID 和 Access Token
   */
  async initialize(): Promise<void> {
    await this.ensureConfigDir();
    const db = openDaemonDb();
    try {
      const existingData = await this.loadAuthData(db);

      if (existingData) {
        this._deviceId = existingData.deviceId;
        this._accessToken = existingData.daemonToken;
        this.authenticatedClients = existingData.authenticatedClients;

        const privateKey = await crypto.subtle.importKey(
          'jwk',
          existingData.privateKeyJwk,
          {
            name: 'ECDH',
            namedCurve: 'P-256',
          },
          true,
          ['deriveKey', 'deriveBits'],
        );

        this.keyPair = {
          publicKey: existingData.publicKey,
          privateKey,
        };
      } else {
        this._deviceId = generateDeviceId();
        this._accessToken = generateAccessToken();
        this.keyPair = await generateKeyPair();
        this.authenticatedClients = [];
        await this.saveAuthData(db);
      }
    } finally {
      db.close();
    }
  }

  /**
   * 获取 Access Token
   */
  get accessToken(): string {
    return this._accessToken;
  }

  /**
   * 重新生成 Access Token
   */
  async regenerateToken(): Promise<string> {
    this._accessToken = generateAccessToken();
    this.authenticatedClients = [];
    this.sharedKeyCache.clear();
    await this.saveAuthData();
    this.emit('tokenGenerated', this._accessToken);
    return this._accessToken;
  }

  /**
   * 完成客户端认证
   */
  async completeAuthentication(
    clientId: string,
    clientPublicKey: string,
    clientName?: string,
  ): Promise<void> {
    const existingIndex = this.authenticatedClients.findIndex((c) => c.clientId === clientId);

    const client: AuthenticatedClient = {
      clientId,
      publicKey: clientPublicKey,
      authenticatedAt: Date.now(),
    };

    if (clientName !== undefined) {
      client.name = clientName;
    }

    if (existingIndex >= 0) {
      this.authenticatedClients[existingIndex] = client;
    } else {
      this.authenticatedClients.push(client);
    }

    await this.deriveAndCacheSharedKey(clientId, clientPublicKey);
    await this.saveAuthData();
    this.emit('clientAuthenticated', client);
  }

  /**
   * 获取共享密钥
   */
  async getSharedKey(clientId: string): Promise<CryptoKey | null> {
    const cached = this.sharedKeyCache.get(clientId);
    if (cached) {
      return cached;
    }

    const client = this.authenticatedClients.find((c) => c.clientId === clientId);
    if (!client) {
      return null;
    }

    return this.deriveAndCacheSharedKey(clientId, client.publicKey);
  }

  /**
   * 检查客户端是否已认证
   */
  isAuthenticated(clientId: string): boolean {
    return this.authenticatedClients.some((c) => c.clientId === clientId);
  }

  /**
   * 更新已认证客户端公钥
   */
  async updateClientPublicKey(
    clientId: string,
    newPublicKey: string,
  ): Promise<void> {
    const client = this.authenticatedClients.find((c) => c.clientId === clientId);
    if (!client) {
      throw new Error(`客户端未认证: ${clientId}`);
    }

    client.publicKey = newPublicKey;
    this.sharedKeyCache.delete(clientId);
    await this.deriveAndCacheSharedKey(clientId, newPublicKey);
    await this.saveAuthData();
    console.log(`已更新客户端公钥: ${clientId}`);
  }

  /**
   * 移除客户端认证
   */
  async removeAuthentication(clientId: string): Promise<void> {
    const index = this.authenticatedClients.findIndex((c) => c.clientId === clientId);
    if (index >= 0) {
      this.authenticatedClients.splice(index, 1);
      this.sharedKeyCache.delete(clientId);
      await this.saveAuthData();
    }
  }

  /**
   * 获取所有已认证客户端
   */
  getAuthenticatedClients(): AuthenticatedClient[] {
    return [...this.authenticatedClients];
  }

  /**
   * 获取设备 ID
   */
  get deviceId(): string {
    return this._deviceId;
  }

  /**
   * 获取公钥
   */
  get publicKey(): string {
    return this.keyPair?.publicKey ?? '';
  }

  private async ensureConfigDir(): Promise<void> {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  }

  private async loadAuthData(db: DatabaseSync): Promise<AuthData | null> {
    let row = db.prepare(`
      SELECT device_id, daemon_token, public_key, private_key_jwk
      FROM daemon_auth
      WHERE id = 1
      LIMIT 1
    `).get() as {
      device_id: string;
      daemon_token: string;
      public_key: string;
      private_key_jwk: string;
    } | undefined;

    if (!row) {
      const migrated = await migrateLegacyAuthJsonIfNeeded(db);
      if (!migrated) {
        return null;
      }
      row = db.prepare(`
        SELECT device_id, daemon_token, public_key, private_key_jwk
        FROM daemon_auth
        WHERE id = 1
        LIMIT 1
      `).get() as {
        device_id: string;
        daemon_token: string;
        public_key: string;
        private_key_jwk: string;
      } | undefined;
      if (!row) {
        return null;
      }
    }

    const clients = db.prepare(`
      SELECT client_id, public_key, authenticated_at, name
      FROM authenticated_clients
      ORDER BY authenticated_at ASC
    `).all() as Array<{
      client_id: string;
      public_key: string;
      authenticated_at: number;
      name: string | null;
    }>;

    return {
      deviceId: row.device_id,
      daemonToken: row.daemon_token,
      publicKey: row.public_key,
      privateKeyJwk: JSON.parse(row.private_key_jwk) as JsonWebKey,
      authenticatedClients: clients.map((client) => ({
        clientId: client.client_id,
        publicKey: client.public_key,
        authenticatedAt: client.authenticated_at,
        ...(client.name ? { name: client.name } : {}),
      })),
    };
  }

  private async saveAuthData(dbInstance?: DatabaseSync): Promise<void> {
    if (!this.keyPair) {
      throw new Error('密钥对未初始化');
    }

    const privateKeyJwk = await crypto.subtle.exportKey('jwk', this.keyPair.privateKey);
    const now = Date.now();

    const db = dbInstance ?? openDaemonDb();
    const needClose = !dbInstance;
    try {
      db.exec('BEGIN');

      db.prepare(`
        INSERT INTO daemon_auth (id, device_id, daemon_token, public_key, private_key_jwk, updated_at)
        VALUES (1, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          device_id = excluded.device_id,
          daemon_token = excluded.daemon_token,
          public_key = excluded.public_key,
          private_key_jwk = excluded.private_key_jwk,
          updated_at = excluded.updated_at
      `).run(
        this._deviceId,
        this._accessToken,
        this.keyPair.publicKey,
        JSON.stringify(privateKeyJwk),
        now,
      );

      db.prepare('DELETE FROM authenticated_clients').run();
      const insertClient = db.prepare(`
        INSERT INTO authenticated_clients (client_id, public_key, authenticated_at, name, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const client of this.authenticatedClients) {
        insertClient.run(
          client.clientId,
          client.publicKey,
          client.authenticatedAt,
          client.name ?? null,
          now,
        );
      }

      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      if (needClose) {
        db.close();
      }
    }
  }

  private async deriveAndCacheSharedKey(
    clientId: string,
    clientPublicKey: string,
  ): Promise<CryptoKey> {
    if (!this.keyPair) {
      throw new Error('密钥对未初始化');
    }

    const sharedKey = await deriveSharedSecret(
      this.keyPair.privateKey,
      clientPublicKey,
    );

    this.sharedKeyCache.set(clientId, sharedKey);
    return sharedKey;
  }
}

// 为 EventEmitter 添加类型支持
export declare interface AuthManager {
  on<K extends keyof AuthManagerEvents>(event: K, listener: AuthManagerEvents[K]): this;
  emit<K extends keyof AuthManagerEvents>(event: K, ...args: Parameters<AuthManagerEvents[K]>): boolean;
  off<K extends keyof AuthManagerEvents>(event: K, listener: AuthManagerEvents[K]): this;
  once<K extends keyof AuthManagerEvents>(event: K, listener: AuthManagerEvents[K]): this;
}
