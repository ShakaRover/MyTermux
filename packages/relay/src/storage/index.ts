import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DaemonProfile, DefaultCommandMode, WebPreferences, WebShortcut } from '@opentermux/shared';
import { decryptToken, deriveAesKey, encryptToken, maskAccessToken } from './crypto.js';

/** 登录尝试记录（按 ip+username 维度） */
export interface LoginAttemptRecord {
  ip: string;
  username: string;
  failedCount: number;
  windowStart: number;
  lockUntil?: number | null;
  lastFailedAt: number;
}

/** Web 会话记录 */
export interface WebSessionRecord {
  sessionId: string;
  username: string;
  csrfToken: string;
  ip?: string | null;
  userAgent?: string | null;
  expiresAt: number;
  createdAt: number;
}

/** daemon 配置写入参数 */
export interface DaemonProfileInput {
  name: string;
  daemonId?: string | null;
  accessToken?: string | null;
  defaultCwd?: string | null;
  defaultCommandMode: DefaultCommandMode;
  defaultCommandValue?: string | null;
}

/** daemon 配置更新参数 */
export interface DaemonProfilePatch {
  name?: string;
  daemonId?: string | null;
  accessToken?: string | null;
  defaultCwd?: string | null;
  defaultCommandMode?: DefaultCommandMode;
  defaultCommandValue?: string | null;
}

/** Web 管理模块默认快捷键 */
export const DEFAULT_WEB_SHORTCUTS: WebShortcut[] = [
  { id: 'ctrl-c', label: 'Ctrl+C', value: '\u0003' },
  { id: 'ctrl-v', label: 'Ctrl+V', value: '\u0016' },
  { id: 'ctrl-d', label: 'Ctrl+D', value: '\u0004' },
  { id: 'ctrl-z', label: 'Ctrl+Z', value: '\u001A' },
  { id: 'ctrl-l', label: 'Ctrl+L', value: '\u000C' },
  { id: 'esc', label: 'Esc', value: '\u001B' },
  { id: 'tab', label: 'Tab', value: '\t' },
  { id: 'arrow-up', label: '↑', value: '\u001B[A' },
  { id: 'arrow-down', label: '↓', value: '\u001B[B' },
  { id: 'arrow-left', label: '←', value: '\u001B[D' },
  { id: 'arrow-right', label: '→', value: '\u001B[C' },
];

/** Web 管理模块默认常用字符 */
export const DEFAULT_COMMON_CHARS = ['/', '~', '|', '&', ';', '$', '*', '{}', '[]', '()'];

/** 中继存储层（SQLite） */
export class RelayStorage {
  private readonly db: DatabaseSync;
  private readonly aesKey: Buffer;

  constructor(dbPath: string, masterKey: string) {
    const resolvedPath = path.resolve(dbPath);
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new DatabaseSync(resolvedPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.aesKey = deriveAesKey(masterKey);
    this.initializeSchema();
  }

  // --------------------------------------------------------------------------
  // Schema
  // --------------------------------------------------------------------------

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS web_admin (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS web_sessions (
        session_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        csrf_token TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_web_sessions_expires_at
        ON web_sessions(expires_at);

      CREATE TABLE IF NOT EXISTS login_attempts (
        ip TEXT NOT NULL,
        username TEXT NOT NULL,
        failed_count INTEGER NOT NULL,
        window_start INTEGER NOT NULL,
        lock_until INTEGER,
        last_failed_at INTEGER NOT NULL,
        PRIMARY KEY (ip, username)
      );

      CREATE TABLE IF NOT EXISTS daemon_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        daemon_id TEXT,
        access_token_encrypted TEXT,
        default_cwd TEXT,
        default_command_mode TEXT NOT NULL,
        default_command_value TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_daemon_profiles_daemon_id
        ON daemon_profiles(daemon_id);

      CREATE TABLE IF NOT EXISTS web_preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        shortcuts_json TEXT NOT NULL,
        common_chars_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // 初始化默认配置
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO web_preferences (id, shortcuts_json, common_chars_json, updated_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      JSON.stringify(DEFAULT_WEB_SHORTCUTS),
      JSON.stringify(DEFAULT_COMMON_CHARS),
      now,
    );
  }

  // --------------------------------------------------------------------------
  // Admin
  // --------------------------------------------------------------------------

  upsertAdmin(username: string, passwordHash: string): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO web_admin (id, username, password_hash, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        password_hash = excluded.password_hash,
        updated_at = excluded.updated_at
    `).run(username, passwordHash, now, now);
  }

  getAdminByUsername(username: string): { username: string; passwordHash: string } | null {
    const row = this.db.prepare(`
      SELECT username, password_hash
      FROM web_admin
      WHERE username = ?
      LIMIT 1
    `).get(username) as { username: string; password_hash: string } | undefined;

    if (!row) return null;
    return {
      username: row.username,
      passwordHash: row.password_hash,
    };
  }

  // --------------------------------------------------------------------------
  // Session
  // --------------------------------------------------------------------------

  createSession(record: Omit<WebSessionRecord, 'createdAt'>): WebSessionRecord {
    const createdAt = Date.now();
    this.db.prepare(`
      INSERT INTO web_sessions (session_id, username, csrf_token, ip, user_agent, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.sessionId,
      record.username,
      record.csrfToken,
      record.ip ?? null,
      record.userAgent ?? null,
      record.expiresAt,
      createdAt,
    );

    return { ...record, createdAt };
  }

  getSession(sessionId: string): WebSessionRecord | null {
    const row = this.db.prepare(`
      SELECT session_id, username, csrf_token, ip, user_agent, expires_at, created_at
      FROM web_sessions
      WHERE session_id = ?
      LIMIT 1
    `).get(sessionId) as {
      session_id: string;
      username: string;
      csrf_token: string;
      ip: string | null;
      user_agent: string | null;
      expires_at: number;
      created_at: number;
    } | undefined;

    if (!row) return null;
    return {
      sessionId: row.session_id,
      username: row.username,
      csrfToken: row.csrf_token,
      ip: row.ip,
      userAgent: row.user_agent,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  deleteSession(sessionId: string): void {
    this.db.prepare('DELETE FROM web_sessions WHERE session_id = ?').run(sessionId);
  }

  deleteExpiredSessions(now = Date.now()): void {
    this.db.prepare('DELETE FROM web_sessions WHERE expires_at <= ?').run(now);
  }

  // --------------------------------------------------------------------------
  // Login attempts
  // --------------------------------------------------------------------------

  getLoginAttempt(ip: string, username: string): LoginAttemptRecord | null {
    const row = this.db.prepare(`
      SELECT ip, username, failed_count, window_start, lock_until, last_failed_at
      FROM login_attempts
      WHERE ip = ? AND username = ?
      LIMIT 1
    `).get(ip, username) as {
      ip: string;
      username: string;
      failed_count: number;
      window_start: number;
      lock_until: number | null;
      last_failed_at: number;
    } | undefined;

    if (!row) return null;
    return {
      ip: row.ip,
      username: row.username,
      failedCount: row.failed_count,
      windowStart: row.window_start,
      lockUntil: row.lock_until,
      lastFailedAt: row.last_failed_at,
    };
  }

  upsertLoginAttempt(record: LoginAttemptRecord): void {
    this.db.prepare(`
      INSERT INTO login_attempts (ip, username, failed_count, window_start, lock_until, last_failed_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(ip, username) DO UPDATE SET
        failed_count = excluded.failed_count,
        window_start = excluded.window_start,
        lock_until = excluded.lock_until,
        last_failed_at = excluded.last_failed_at
    `).run(
      record.ip,
      record.username,
      record.failedCount,
      record.windowStart,
      record.lockUntil ?? null,
      record.lastFailedAt,
    );
  }

  deleteLoginAttempt(ip: string, username: string): void {
    this.db.prepare('DELETE FROM login_attempts WHERE ip = ? AND username = ?').run(ip, username);
  }

  // --------------------------------------------------------------------------
  // Daemon profiles
  // --------------------------------------------------------------------------

  listDaemonProfiles(): DaemonProfile[] {
    const rows = this.db.prepare(`
      SELECT id, name, daemon_id, access_token_encrypted, default_cwd, default_command_mode,
             default_command_value, created_at, updated_at
      FROM daemon_profiles
      ORDER BY updated_at DESC
    `).all() as Array<{
      id: string;
      name: string;
      daemon_id: string | null;
      access_token_encrypted: string | null;
      default_cwd: string | null;
      default_command_mode: DefaultCommandMode;
      default_command_value: string | null;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map((row) => this.mapDaemonProfile(row));
  }

  getDaemonProfile(profileId: string): DaemonProfile | null {
    const row = this.db.prepare(`
      SELECT id, name, daemon_id, access_token_encrypted, default_cwd, default_command_mode,
             default_command_value, created_at, updated_at
      FROM daemon_profiles
      WHERE id = ?
      LIMIT 1
    `).get(profileId) as {
      id: string;
      name: string;
      daemon_id: string | null;
      access_token_encrypted: string | null;
      default_cwd: string | null;
      default_command_mode: DefaultCommandMode;
      default_command_value: string | null;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!row) return null;
    return this.mapDaemonProfile(row);
  }

  createDaemonProfile(profileId: string, input: DaemonProfileInput): DaemonProfile {
    const now = Date.now();
    const encrypted = input.accessToken ? encryptToken(input.accessToken, this.aesKey) : null;

    this.db.prepare(`
      INSERT INTO daemon_profiles (
        id, name, daemon_id, access_token_encrypted, default_cwd,
        default_command_mode, default_command_value, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      profileId,
      input.name,
      input.daemonId ?? null,
      encrypted,
      input.defaultCwd ?? null,
      input.defaultCommandMode,
      input.defaultCommandValue ?? null,
      now,
      now,
    );

    const created = this.getDaemonProfile(profileId);
    if (!created) {
      throw new Error('创建 daemon 配置失败');
    }
    return created;
  }

  updateDaemonProfile(profileId: string, patch: DaemonProfilePatch): DaemonProfile {
    const current = this.db.prepare(`
      SELECT access_token_encrypted
      FROM daemon_profiles
      WHERE id = ?
      LIMIT 1
    `).get(profileId) as { access_token_encrypted: string | null } | undefined;

    if (!current) {
      throw new Error('daemon 配置不存在');
    }

    let encryptedToken: string | null = current.access_token_encrypted;
    if (patch.accessToken !== undefined) {
      encryptedToken = patch.accessToken
        ? encryptToken(patch.accessToken, this.aesKey)
        : null;
    }

    const now = Date.now();
    this.db.prepare(`
      UPDATE daemon_profiles
      SET
        name = COALESCE(?, name),
        daemon_id = CASE WHEN ? THEN ? ELSE daemon_id END,
        access_token_encrypted = ?,
        default_cwd = CASE WHEN ? THEN ? ELSE default_cwd END,
        default_command_mode = COALESCE(?, default_command_mode),
        default_command_value = CASE WHEN ? THEN ? ELSE default_command_value END,
        updated_at = ?
      WHERE id = ?
    `).run(
      patch.name ?? null,
      patch.daemonId !== undefined ? 1 : 0,
      patch.daemonId ?? null,
      encryptedToken,
      patch.defaultCwd !== undefined ? 1 : 0,
      patch.defaultCwd ?? null,
      patch.defaultCommandMode ?? null,
      patch.defaultCommandValue !== undefined ? 1 : 0,
      patch.defaultCommandValue ?? null,
      now,
      profileId,
    );

    const updated = this.getDaemonProfile(profileId);
    if (!updated) {
      throw new Error('更新 daemon 配置失败');
    }
    return updated;
  }

  bindDaemonProfile(profileId: string, daemonId: string | null): DaemonProfile {
    this.db.prepare(`
      UPDATE daemon_profiles
      SET daemon_id = ?, updated_at = ?
      WHERE id = ?
    `).run(daemonId, Date.now(), profileId);

    const updated = this.getDaemonProfile(profileId);
    if (!updated) {
      throw new Error('绑定 daemon 失败');
    }
    return updated;
  }

  getDaemonProfileToken(profileId: string): string | null {
    const row = this.db.prepare(`
      SELECT access_token_encrypted
      FROM daemon_profiles
      WHERE id = ?
      LIMIT 1
    `).get(profileId) as { access_token_encrypted: string | null } | undefined;

    if (!row?.access_token_encrypted) {
      return null;
    }
    return decryptToken(row.access_token_encrypted, this.aesKey);
  }

  // --------------------------------------------------------------------------
  // Preferences
  // --------------------------------------------------------------------------

  getWebPreferences(): WebPreferences {
    const row = this.db.prepare(`
      SELECT shortcuts_json, common_chars_json, updated_at
      FROM web_preferences
      WHERE id = 1
      LIMIT 1
    `).get() as {
      shortcuts_json: string;
      common_chars_json: string;
      updated_at: number;
    } | undefined;

    if (!row) {
      return {
        shortcuts: DEFAULT_WEB_SHORTCUTS,
        commonChars: DEFAULT_COMMON_CHARS,
        updatedAt: Date.now(),
      };
    }

    try {
      return {
        shortcuts: JSON.parse(row.shortcuts_json) as WebShortcut[],
        commonChars: JSON.parse(row.common_chars_json) as string[],
        updatedAt: row.updated_at,
      };
    } catch {
      return {
        shortcuts: DEFAULT_WEB_SHORTCUTS,
        commonChars: DEFAULT_COMMON_CHARS,
        updatedAt: row.updated_at,
      };
    }
  }

  upsertWebPreferences(shortcuts: WebShortcut[], commonChars: string[]): WebPreferences {
    const updatedAt = Date.now();
    this.db.prepare(`
      INSERT INTO web_preferences (id, shortcuts_json, common_chars_json, updated_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        shortcuts_json = excluded.shortcuts_json,
        common_chars_json = excluded.common_chars_json,
        updated_at = excluded.updated_at
    `).run(JSON.stringify(shortcuts), JSON.stringify(commonChars), updatedAt);

    return { shortcuts, commonChars, updatedAt };
  }

  // --------------------------------------------------------------------------
  // Private utils
  // --------------------------------------------------------------------------

  private mapDaemonProfile(row: {
    id: string;
    name: string;
    daemon_id: string | null;
    access_token_encrypted: string | null;
    default_cwd: string | null;
    default_command_mode: DefaultCommandMode;
    default_command_value: string | null;
    created_at: number;
    updated_at: number;
  }): DaemonProfile {
    let masked: string | null = null;
    if (row.access_token_encrypted) {
      try {
        const plaintext = decryptToken(row.access_token_encrypted, this.aesKey);
        masked = maskAccessToken(plaintext);
      } catch {
        masked = '***';
      }
    }

    return {
      id: row.id,
      name: row.name,
      daemonId: row.daemon_id,
      accessTokenMasked: masked,
      hasToken: !!row.access_token_encrypted,
      defaultCwd: row.default_cwd,
      defaultCommandMode: row.default_command_mode,
      defaultCommandValue: row.default_command_value,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

