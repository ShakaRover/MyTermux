/**
 * 认证管理器
 *
 * 管理 daemon 的 Access Token 和已认证客户端，处理密钥存储
 * Token 模式：daemon 启动时生成 Access Token，客户端使用 Token 连接
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { KeyPair } from '@mycc/shared';
import {
  generateAccessToken,
  generateKeyPair,
  deriveSharedSecret,
} from '@mycc/shared';

// ============================================================================
// 类型定义
// ============================================================================

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
  /** Access Token（客户端使用此 Token 连接） */
  accessToken: string;
  /** 本地公钥 */
  publicKey: string;
  /** 本地私钥（导出格式） */
  privateKeyJwk: JsonWebKey;
  /** 已认证的客户端列表 */
  authenticatedClients: AuthenticatedClient[];
}

/** 认证管理器事件 */
export interface PairingManagerEvents {
  /** Token 已生成 */
  tokenGenerated: (token: string) => void;
  /** 客户端认证成功 */
  clientAuthenticated: (client: AuthenticatedClient) => void;
}

// ============================================================================
// 常量定义
// ============================================================================

/** 配置文件目录 */
const CONFIG_DIR = path.join(os.homedir(), '.mycc');

/** 认证数据文件路径 */
const AUTH_DATA_FILE = path.join(CONFIG_DIR, 'pairing.json');

// ============================================================================
// 导出工具函数
// ============================================================================

/**
 * I12: 读取并返回 Access Token（供 CLI token 命令使用）
 *
 * 封装了文件读取、JSON 解析和旧版数据迁移逻辑，
 * 避免在 index.ts 中重复迁移代码
 *
 * @returns { token, migrated } token 为 Access Token，migrated 表示是否进行了数据迁移
 * @throws 文件不存在时抛出 ENOENT 错误
 */
export async function readAccessToken(): Promise<{ token: string; migrated: boolean }> {
  const content = await fs.readFile(AUTH_DATA_FILE, 'utf-8');
  const data = JSON.parse(content) as Record<string, unknown>;

  let migrated = false;

  // 兼容旧版：补充 accessToken
  if (!data.accessToken) {
    const { generateAccessToken } = await import('@mycc/shared');
    data.accessToken = generateAccessToken();
    migrated = true;
  }

  // 兼容旧版字段名
  if (!data.authenticatedClients && data.pairedClients) {
    data.authenticatedClients = data.pairedClients;
    delete data.pairedClients;
    migrated = true;
  }

  // 如果进行了迁移，写回文件
  if (migrated) {
    await fs.writeFile(AUTH_DATA_FILE, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  }

  return { token: data.accessToken as string, migrated };
}

// ============================================================================
// 认证管理器类
// ============================================================================

/**
 * 认证管理器
 *
 * 历史兼容：类名保留为 PairingManager（原为配对管理器），
 * 避免外部引用（如 daemon.ts、ws-client.ts、测试文件）需要同步重命名。
 * 实际功能已迁移为 Access Token 认证模式：
 * - 方法名 completePairing/isPaired/getPairedClients 等保留旧命名
 * - 数据文件名 pairing.json 保留，确保版本升级时无需用户干预
 *
 * 特性：
 * - 生成和管理 Access Token
 * - 处理客户端认证
 * - 管理密钥存储
 * - 派生共享密钥用于 E2E 加密
 */
export class PairingManager extends EventEmitter {
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

  // --------------------------------------------------------------------------
  // 公共方法
  // --------------------------------------------------------------------------

  /**
   * 初始化认证管理器
   * 加载或生成密钥对、设备 ID 和 Access Token
   */
  async initialize(): Promise<void> {
    await this.ensureConfigDir();

    const existingData = await this.loadAuthData();

    if (existingData) {
      // 恢复现有数据
      this._deviceId = existingData.deviceId;
      this._accessToken = existingData.accessToken;
      this.authenticatedClients = existingData.authenticatedClients;

      // 从 JWK 导入私钥
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        existingData.privateKeyJwk,
        {
          name: 'ECDH',
          namedCurve: 'P-256',
        },
        true,
        ['deriveKey', 'deriveBits']
      );

      this.keyPair = {
        publicKey: existingData.publicKey,
        privateKey,
      };

      // 如果 loadAuthData 进行了旧版数据迁移（如补充 accessToken、重命名字段），
      // 将迁移结果持久化回磁盘，避免每次启动重复迁移
      await this.saveAuthData();
    } else {
      // 生成新数据
      this._deviceId = this.generateDeviceId();
      this._accessToken = generateAccessToken();
      this.keyPair = await generateKeyPair();
      this.authenticatedClients = [];

      await this.saveAuthData();
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
   * @returns 新的 Access Token
   */
  async regenerateToken(): Promise<string> {
    this._accessToken = generateAccessToken();
    // 清除所有已认证客户端（Token 变了，旧客户端需要重新认证）
    this.authenticatedClients = [];
    this.sharedKeyCache.clear();
    await this.saveAuthData();
    this.emit('tokenGenerated', this._accessToken);
    return this._accessToken;
  }

  /**
   * 完成客户端认证
   * @param clientId 客户端设备 ID
   * @param clientPublicKey 客户端公钥
   * @param clientName 客户端名称（可选）
   */
  async completePairing(
    clientId: string,
    clientPublicKey: string,
    clientName?: string
  ): Promise<void> {
    // 检查是否已认证
    const existingIndex = this.authenticatedClients.findIndex(
      (c) => c.clientId === clientId
    );

    const client: AuthenticatedClient = {
      clientId,
      publicKey: clientPublicKey,
      authenticatedAt: Date.now(),
    };

    if (clientName !== undefined) {
      client.name = clientName;
    }

    if (existingIndex >= 0) {
      // 更新现有认证
      this.authenticatedClients[existingIndex] = client;
    } else {
      // 添加新认证
      this.authenticatedClients.push(client);
    }

    // 派生并缓存共享密钥
    await this.deriveAndCacheSharedKey(clientId, clientPublicKey);

    // 保存认证数据
    await this.saveAuthData();

    this.emit('clientAuthenticated', client);
  }

  /**
   * 获取共享密钥
   * @param clientId 客户端 ID
   * @returns 共享密钥（如果已认证）
   */
  async getSharedKey(clientId: string): Promise<CryptoKey | null> {
    // 尝试从缓存获取
    const cached = this.sharedKeyCache.get(clientId);
    if (cached) {
      return cached;
    }

    // 查找认证信息
    const client = this.authenticatedClients.find((c) => c.clientId === clientId);
    if (!client) {
      return null;
    }

    // 派生并缓存共享密钥
    return this.deriveAndCacheSharedKey(clientId, client.publicKey);
  }

  /**
   * 检查客户端是否已认证
   * @param clientId 客户端 ID
   */
  isPaired(clientId: string): boolean {
    return this.authenticatedClients.some((c) => c.clientId === clientId);
  }

  /**
   * 更新已认证客户端的公钥（用于重连时）
   * @param clientId 客户端 ID
   * @param newPublicKey 新的公钥
   */
  async updateClientPublicKey(
    clientId: string,
    newPublicKey: string
  ): Promise<void> {
    const client = this.authenticatedClients.find((c) => c.clientId === clientId);
    if (!client) {
      throw new Error(`客户端未认证: ${clientId}`);
    }

    // 更新公钥
    client.publicKey = newPublicKey;

    // 清除旧的共享密钥缓存
    this.sharedKeyCache.delete(clientId);

    // 派生并缓存新的共享密钥
    await this.deriveAndCacheSharedKey(clientId, newPublicKey);

    // 保存认证数据
    await this.saveAuthData();

    console.log(`已更新客户端公钥: ${clientId}`);
  }

  /**
   * 移除客户端认证
   * @param clientId 客户端 ID
   */
  async removePairing(clientId: string): Promise<void> {
    const index = this.authenticatedClients.findIndex((c) => c.clientId === clientId);
    if (index >= 0) {
      this.authenticatedClients.splice(index, 1);
      this.sharedKeyCache.delete(clientId);
      await this.saveAuthData();
    }
  }

  /**
   * 获取所有已认证的客户端
   */
  getPairedClients(): AuthenticatedClient[] {
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

  // --------------------------------------------------------------------------
  // 私有方法
  // --------------------------------------------------------------------------

  /**
   * 生成设备 ID
   */
  private generateDeviceId(): string {
    const array = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(array)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * 确保配置目录存在
   */
  private async ensureConfigDir(): Promise<void> {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  }

  /**
   * 加载认证数据
   * 文件不存在时返回 null，文件损坏或解析失败时抛出错误
   */
  private async loadAuthData(): Promise<AuthData | null> {
    let content: string;
    try {
      content = await fs.readFile(AUTH_DATA_FILE, 'utf-8');
    } catch (error) {
      // 文件不存在：首次启动，返回 null
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }

    // 文件存在但解析失败时，让错误向上传播
    const data = JSON.parse(content) as AuthData;

    // 兼容旧版数据
    if (!data.accessToken) {
      data.accessToken = generateAccessToken();
    }
    // 旧版字段名为 pairedClients，新版为 authenticatedClients
    const dataAsRecord = data as unknown as Record<string, unknown>;
    if (!data.authenticatedClients && dataAsRecord['pairedClients']) {
      data.authenticatedClients = dataAsRecord['pairedClients'] as AuthenticatedClient[];
    }
    return data;
  }

  /**
   * 保存认证数据
   */
  private async saveAuthData(): Promise<void> {
    if (!this.keyPair) {
      throw new Error('密钥对未初始化');
    }

    // 导出私钥为 JWK 格式
    const privateKeyJwk = await crypto.subtle.exportKey(
      'jwk',
      this.keyPair.privateKey
    );

    const data: AuthData = {
      deviceId: this._deviceId,
      accessToken: this._accessToken,
      publicKey: this.keyPair.publicKey,
      privateKeyJwk,
      authenticatedClients: this.authenticatedClients,
    };

    await fs.writeFile(AUTH_DATA_FILE, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  }

  /**
   * 派生并缓存共享密钥
   */
  private async deriveAndCacheSharedKey(
    clientId: string,
    clientPublicKey: string
  ): Promise<CryptoKey> {
    if (!this.keyPair) {
      throw new Error('密钥对未初始化');
    }

    const sharedKey = await deriveSharedSecret(
      this.keyPair.privateKey,
      clientPublicKey
    );

    this.sharedKeyCache.set(clientId, sharedKey);
    return sharedKey;
  }
}

// ============================================================================
// 类型增强
// ============================================================================

// 为 EventEmitter 添加类型支持
export declare interface PairingManager {
  on<K extends keyof PairingManagerEvents>(event: K, listener: PairingManagerEvents[K]): this;
  emit<K extends keyof PairingManagerEvents>(event: K, ...args: Parameters<PairingManagerEvents[K]>): boolean;
  off<K extends keyof PairingManagerEvents>(event: K, listener: PairingManagerEvents[K]): this;
  once<K extends keyof PairingManagerEvents>(event: K, listener: PairingManagerEvents[K]): this;
}
