import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface WebAuthSession {
  authenticated: boolean;
  username: string;
  mustChangePassword: boolean;
  expiresAt: number;
}

interface WebAuthSessionInternal {
  sessionId: string;
  session: WebAuthSession;
}

interface StoredAdminAccount {
  username: string;
  passwordHash: string;
  mustChangePassword: number;
}

export interface WebAuthStorageOptions {
  adminUsername?: string;
  adminPassword?: string;
}

export class WebAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'mytermux';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function hashPassword(password: string, saltHex?: string): string {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }

  const saltHex = parts[1];
  const expectedHex = parts[2];
  if (!saltHex || !expectedHex) {
    return false;
  }

  const expected = Buffer.from(expectedHex, 'hex');
  const actualHex = hashPassword(password, saltHex).split('$')[2];
  if (!actualHex) {
    return false;
  }
  const actual = Buffer.from(actualHex, 'hex');
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}

function validateUsername(username: string): string {
  const normalized = username.trim();
  if (!normalized) {
    throw new WebAuthError(400, 'INVALID_INPUT', '用户名不能为空');
  }
  if (normalized.length < 3 || normalized.length > 64) {
    throw new WebAuthError(400, 'INVALID_INPUT', '用户名长度必须在 3-64 之间');
  }
  return normalized;
}

function validatePassword(password: string): string {
  const normalized = password.trim();
  if (!normalized) {
    throw new WebAuthError(400, 'INVALID_INPUT', '密码不能为空');
  }
  if (normalized.length < 8) {
    throw new WebAuthError(400, 'INVALID_INPUT', '密码长度至少 8 位');
  }
  return normalized;
}

function unauthenticatedSession(): WebAuthSession {
  return {
    authenticated: false,
    username: '',
    mustChangePassword: false,
    expiresAt: 0,
  };
}

export class WebAuthStorage {
  private readonly db: DatabaseSync;
  private readonly options: WebAuthStorageOptions;

  constructor(dbPath: string, options: WebAuthStorageOptions = {}) {
    const resolvedPath = path.resolve(dbPath);
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new DatabaseSync(resolvedPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.options = options;
    this.initializeSchema();
    this.ensureAdminAccount();
  }

  getSessionTtlMs(): number {
    return SESSION_TTL_MS;
  }

  getSessionById(sessionId?: string): WebAuthSession {
    if (!sessionId) {
      return unauthenticatedSession();
    }

    const sessionRow = this.db.prepare(`
      SELECT username, expires_at
      FROM web_sessions
      WHERE session_id = ?
      LIMIT 1
    `).get(sessionId) as { username: string; expires_at: number } | undefined;
    if (!sessionRow) {
      return unauthenticatedSession();
    }

    if (sessionRow.expires_at <= Date.now()) {
      this.db.prepare('DELETE FROM web_sessions WHERE session_id = ?').run(sessionId);
      return unauthenticatedSession();
    }

    const account = this.getAdminAccount();
    if (account.username !== sessionRow.username) {
      this.db.prepare('DELETE FROM web_sessions WHERE session_id = ?').run(sessionId);
      return unauthenticatedSession();
    }

    return {
      authenticated: true,
      username: account.username,
      mustChangePassword: account.mustChangePassword === 1,
      expiresAt: sessionRow.expires_at,
    };
  }

  login(username: string, password: string): WebAuthSessionInternal {
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      throw new WebAuthError(400, 'INVALID_INPUT', '用户名和密码不能为空');
    }

    const account = this.getAdminAccount();
    if (normalizedUsername !== account.username || !verifyPassword(password, account.passwordHash)) {
      throw new WebAuthError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
    }

    return this.createSession(account.username, account.mustChangePassword === 1);
  }

  updateCredentials(sessionId: string, username: string, password: string): WebAuthSessionInternal {
    const current = this.getSessionById(sessionId);
    if (!current.authenticated) {
      throw new WebAuthError(401, 'UNAUTHORIZED', '请先登录');
    }

    const account = this.getAdminAccount();
    const normalizedUsername = validateUsername(username);
    const normalizedPassword = validatePassword(password);
    const newHash = hashPassword(normalizedPassword);

    if (account.mustChangePassword === 1) {
      if (normalizedUsername === account.username) {
        throw new WebAuthError(400, 'INVALID_INPUT', '首次修改时必须更换用户名');
      }
      if (verifyPassword(normalizedPassword, account.passwordHash)) {
        throw new WebAuthError(400, 'INVALID_INPUT', '首次修改时必须更换密码');
      }
    }

    this.db.exec('BEGIN');
    try {
      this.db.prepare(`
        UPDATE web_admin_account
        SET username = ?, password_hash = ?, must_change_password = 0, updated_at = ?
        WHERE id = 1
      `).run(normalizedUsername, newHash, Date.now());

      // 账号变更后，废弃所有旧会话，重新签发当前会话
      this.db.prepare('DELETE FROM web_sessions').run();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return this.createSession(normalizedUsername, false);
  }

  logout(sessionId?: string): void {
    if (!sessionId) {
      return;
    }
    this.db.prepare('DELETE FROM web_sessions WHERE session_id = ?').run(sessionId);
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS web_admin_account (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        must_change_password INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS web_sessions (
        session_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_web_sessions_expires_at
        ON web_sessions(expires_at);
    `);
  }

  private ensureAdminAccount(): void {
    const existing = this.db.prepare(`
      SELECT username, password_hash AS passwordHash, must_change_password AS mustChangePassword
      FROM web_admin_account
      WHERE id = 1
      LIMIT 1
    `).get() as StoredAdminAccount | undefined;
    if (existing?.username && existing.passwordHash) {
      return;
    }

    const username = (this.options.adminUsername || DEFAULT_USERNAME).trim() || DEFAULT_USERNAME;
    const password = this.options.adminPassword || DEFAULT_PASSWORD;
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO web_admin_account (id, username, password_hash, must_change_password, updated_at)
      VALUES (1, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        password_hash = excluded.password_hash,
        must_change_password = excluded.must_change_password,
        updated_at = excluded.updated_at
    `).run(username, hashPassword(password), now);
  }

  private getAdminAccount(): StoredAdminAccount {
    const row = this.db.prepare(`
      SELECT username, password_hash AS passwordHash, must_change_password AS mustChangePassword
      FROM web_admin_account
      WHERE id = 1
      LIMIT 1
    `).get() as StoredAdminAccount | undefined;

    if (!row) {
      throw new WebAuthError(500, 'SERVICE_UNAVAILABLE', 'Web 认证服务未初始化');
    }
    return row;
  }

  private createSession(username: string, mustChangePassword: boolean): WebAuthSessionInternal {
    const sessionId = `${randomUUID()}-${randomBytes(12).toString('hex')}`;
    const expiresAt = Date.now() + SESSION_TTL_MS;
    this.db.prepare(`
      INSERT INTO web_sessions (session_id, username, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, username, expiresAt, Date.now());

    return {
      sessionId,
      session: {
        authenticated: true,
        username,
        mustChangePassword,
        expiresAt,
      },
    };
  }
}
