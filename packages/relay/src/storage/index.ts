import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DaemonProfile, DefaultCommandMode } from '@mytermux/shared';
import { decryptToken, deriveAesKey, encryptToken, maskAccessToken } from './crypto.js';

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

  private initializeSchema(): void {
    this.db.exec(`
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
    `);
  }

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

  getDaemonProfileByDaemonId(daemonId: string): DaemonProfile | null {
    const row = this.db.prepare(`
      SELECT id, name, daemon_id, access_token_encrypted, default_cwd, default_command_mode,
             default_command_value, created_at, updated_at
      FROM daemon_profiles
      WHERE daemon_id = ?
      LIMIT 1
    `).get(daemonId) as {
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

  deleteDaemonProfile(profileId: string): void {
    const existing = this.getDaemonProfile(profileId);
    if (!existing) {
      throw new Error('daemon 配置不存在');
    }

    this.db.prepare('DELETE FROM daemon_profiles WHERE id = ?').run(profileId);
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
