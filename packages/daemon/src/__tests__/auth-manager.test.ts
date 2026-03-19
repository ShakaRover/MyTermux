import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const ORIGINAL_HOME = process.env['HOME'] || '';

describe('auth-manager 持久化接口', () => {
  let tempHome = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mytermux-daemon-auth-'));
    process.env['HOME'] = tempHome;
    vi.resetModules();
  });

  afterEach(async () => {
    process.env['HOME'] = ORIGINAL_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('resetAccessToken 应生成新 token 并清空已认证客户端', async () => {
    const authModule = await import('../auth-manager.js');
    const manager = new authModule.AuthManager();
    await manager.initialize();
    const oldToken = manager.accessToken;

    const dbPath = path.join(tempHome, '.mytermux', 'daemon.db');
    const db = new DatabaseSync(dbPath);
    db.prepare(`
      INSERT INTO authenticated_clients (client_id, public_key, authenticated_at, name, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('client-1', 'pk-1', Date.now(), null, Date.now());
    db.close();

    const { token: newToken } = await authModule.resetAccessToken();
    expect(newToken).not.toBe(oldToken);

    const verifyDb = new DatabaseSync(dbPath);
    const row = verifyDb.prepare(`
      SELECT daemon_token
      FROM daemon_auth
      WHERE id = 1
      LIMIT 1
    `).get() as { daemon_token: string };
    const clients = verifyDb.prepare('SELECT COUNT(*) as total FROM authenticated_clients')
      .get() as { total: number };
    verifyDb.close();

    expect(row.daemon_token).toBe(newToken);
    expect(clients.total).toBe(0);
  });

  it('应支持设置、读取和清空 daemon relay token', async () => {
    const authModule = await import('../auth-manager.js');
    const manager = new authModule.AuthManager();
    await manager.initialize();

    await authModule.setDaemonLinkToken('server-link-token-123');
    const saved = await authModule.readDaemonLinkToken();
    expect(saved).toBe('server-link-token-123');

    await authModule.clearDaemonLinkToken();
    const cleared = await authModule.readDaemonLinkToken();
    expect(cleared).toBeNull();
  });
});
