import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../server';
import { WebAuthStorage } from '../web-auth-storage';

interface TestContext {
  tmpDir: string;
  webAuthStorage: WebAuthStorage;
  app: ReturnType<typeof createServer>;
}

const contexts: TestContext[] = [];

afterEach(() => {
  while (contexts.length > 0) {
    const context = contexts.pop();
    if (!context) {
      continue;
    }
    fs.rmSync(context.tmpDir, { recursive: true, force: true });
  }
});

function createTestContext(): TestContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mytermux-web-auth-'));
  const webAuthStorage = new WebAuthStorage(path.join(tmpDir, 'web.db'));
  const app = createServer({ webAuthStorage });
  const context: TestContext = { tmpDir, webAuthStorage, app };
  contexts.push(context);
  return context;
}

function extractSessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie') || '';
  const first = setCookie.split(';')[0]?.trim();
  return first || '';
}

describe('WebAuth API integration', () => {
  it('默认账号可登录，且首次登录必须改密', async () => {
    const { app } = createTestContext();

    const loginResp = await app.request('/api/web-auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'mytermux',
      }),
    });
    expect(loginResp.status).toBe(200);
    const body = await loginResp.json() as { authenticated: boolean; mustChangePassword: boolean; username: string };
    expect(body.authenticated).toBe(true);
    expect(body.username).toBe('admin');
    expect(body.mustChangePassword).toBe(true);

    const cookie = extractSessionCookie(loginResp);
    expect(cookie).toContain('mytermux_web_session=');

    const sessionResp = await app.request('/api/web-auth/session', {
      headers: { cookie },
    });
    expect(sessionResp.status).toBe(200);
    const session = await sessionResp.json() as { authenticated: boolean; mustChangePassword: boolean };
    expect(session.authenticated).toBe(true);
    expect(session.mustChangePassword).toBe(true);
  });

  it('修改账号密码后应持久化到 web.db，并且旧密码失效', async () => {
    const { app, webAuthStorage } = createTestContext();

    const loginResp = await app.request('/api/web-auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'mytermux',
      }),
    });
    expect(loginResp.status).toBe(200);
    const cookie = extractSessionCookie(loginResp);

    const updateResp = await app.request('/api/web-auth/update-credentials', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        username: 'alice',
        password: 'alice-password-123',
      }),
    });
    expect(updateResp.status).toBe(200);
    const updated = await updateResp.json() as { authenticated: boolean; username: string; mustChangePassword: boolean };
    expect(updated.authenticated).toBe(true);
    expect(updated.username).toBe('alice');
    expect(updated.mustChangePassword).toBe(false);

    const oldLoginResp = await app.request('/api/web-auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'mytermux',
      }),
    });
    expect(oldLoginResp.status).toBe(401);

    // 新建 app（模拟新浏览器/新会话）后，仍可用新账号登录
    const app2 = createServer({ webAuthStorage });
    const newLoginResp = await app2.request('/api/web-auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'alice',
        password: 'alice-password-123',
      }),
    });
    expect(newLoginResp.status).toBe(200);
  });
});
