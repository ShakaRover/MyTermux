import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceRegistry } from '../device-registry';
import { createServer } from '../server';
import { LoginBruteforceGuard } from '../auth/bruteforce';
import { hashPassword } from '../auth/password';
import { WebSessionService } from '../auth/session';
import { WsTicketService } from '../auth/ws-ticket';
import { RelayStorage } from '../storage';

interface TestContext {
  tmpDir: string;
  deviceRegistry: DeviceRegistry;
  storage: RelayStorage;
  sessionService: WebSessionService;
  wsTicketService: WsTicketService;
  app: ReturnType<typeof createServer>;
}

const contexts: TestContext[] = [];

afterEach(() => {
  while (contexts.length > 0) {
    const context = contexts.pop();
    if (!context) {
      continue;
    }

    context.deviceRegistry.stopCleanupTimer();
    fs.rmSync(context.tmpDir, { recursive: true, force: true });
  }
});

function createTestContext(): TestContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentermux-relay-api-'));
  const storage = new RelayStorage(path.join(tmpDir, 'relay.db'), 'test-master-key');
  storage.upsertAdmin('admin', hashPassword('secret-pass'));

  const deviceRegistry = new DeviceRegistry();
  const sessionService = new WebSessionService(storage);
  const loginGuard = new LoginBruteforceGuard(storage);
  const wsTicketService = new WsTicketService();

  const app = createServer({
    deviceRegistry,
    storage,
    sessionService,
    loginGuard,
    wsTicketService,
  });

  const context: TestContext = {
    tmpDir,
    storage,
    deviceRegistry,
    sessionService,
    wsTicketService,
    app,
  };
  contexts.push(context);
  return context;
}

function extractCookieHeader(response: Response): string {
  const setCookies = getSetCookies(response);

  const cookiePairs = setCookies
    .map((cookie) => cookie.split(';')[0])
    .filter((cookie): cookie is string => !!cookie);

  return cookiePairs.join('; ');
}

function getSetCookies(response: Response): string[] {
  const headersWithGetSetCookie = response.headers as unknown as {
    getSetCookie?: () => string[];
  };

  if (typeof headersWithGetSetCookie.getSetCookie === 'function') {
    return headersWithGetSetCookie.getSetCookie();
  }

  const raw = response.headers.get('set-cookie');
  if (!raw) {
    return [];
  }

  // 兼容不支持 getSetCookie 的环境，按 cookie 边界切分
  return raw.split(/,(?=[^;,]+=)/);
}

function createMockWs() {
  return {
    close: () => undefined,
    send: () => undefined,
    readyState: 1,
  } as unknown as import('ws').WebSocket;
}

describe('Relay API integration', () => {
  it('should complete login -> csrf -> profile -> ws-ticket flow', async () => {
    const { app, wsTicketService } = createTestContext();

    const loginResponse = await app.request('/api/web-auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'secret-pass',
      }),
    });

    expect(loginResponse.status).toBe(200);
    const cookies = extractCookieHeader(loginResponse);
    expect(cookies.includes('opentermux_web_session=')).toBe(true);

    const csrfResponse = await app.request('/api/web-auth/csrf', {
      headers: {
        cookie: cookies,
      },
    });

    expect(csrfResponse.status).toBe(200);
    const csrfBody = await csrfResponse.json() as { csrfToken: string };
    expect(csrfBody.csrfToken.length).toBeGreaterThan(10);

    const profileResponse = await app.request('/api/daemon-profiles', {
      method: 'POST',
      headers: {
        cookie: cookies,
        'x-csrf-token': csrfBody.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'macbook',
        accessToken: 'opentermux-1234567890abcdef1234567890abcdef',
        defaultCwd: '/tmp',
        defaultCommandMode: 'tmux',
      }),
    });

    expect(profileResponse.status).toBe(201);
    const profileBody = await profileResponse.json() as {
      profile: { id: string; name: string; hasToken: boolean };
    };

    expect(profileBody.profile.name).toBe('macbook');
    expect(profileBody.profile.hasToken).toBe(true);

    const wsTicketResponse = await app.request('/api/ws-ticket', {
      method: 'POST',
      headers: {
        cookie: cookies,
        'x-csrf-token': csrfBody.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profileId: profileBody.profile.id,
      }),
    });

    expect(wsTicketResponse.status).toBe(200);
    const wsTicketBody = await wsTicketResponse.json() as { ticket: string; profileId: string };
    expect(wsTicketBody.profileId).toBe(profileBody.profile.id);

    const consumed = wsTicketService.consume(wsTicketBody.ticket);
    expect(consumed?.profileId).toBe(profileBody.profile.id);
    expect(wsTicketService.consume(wsTicketBody.ticket)).toBeNull();
  });

  it('should reject protected api when unauthenticated', async () => {
    const { app } = createTestContext();

    const response = await app.request('/api/daemons');
    expect(response.status).toBe(401);
  });

  it('should enforce csrf for write operations', async () => {
    const { app } = createTestContext();

    const loginResponse = await app.request('/api/web-auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'secret-pass',
      }),
    });

    const cookies = extractCookieHeader(loginResponse);

    const createProfileResponse = await app.request('/api/daemon-profiles', {
      method: 'POST',
      headers: {
        cookie: cookies,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'without-csrf',
        defaultCommandMode: 'zsh',
      }),
    });

    expect(createProfileResponse.status).toBe(403);
  });

  it('should merge online daemon and profile status in /api/daemons', async () => {
    const { app, deviceRegistry, storage } = createTestContext();

    deviceRegistry.registerDevice(
      createMockWs(),
      'daemon-online-1',
      'daemon',
      'daemon-public-key',
      'opentermux-aabbccddeeff00112233445566778899',
    );

    storage.createDaemonProfile('profile-1', {
      name: 'online-daemon-profile',
      daemonId: 'daemon-online-1',
      accessToken: 'opentermux-aabbccddeeff00112233445566778899',
      defaultCommandMode: 'zsh',
    });

    const loginResponse = await app.request('/api/web-auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'secret-pass',
      }),
    });

    const cookies = extractCookieHeader(loginResponse);

    const daemonsResponse = await app.request('/api/daemons', {
      headers: {
        cookie: cookies,
      },
    });

    expect(daemonsResponse.status).toBe(200);

    const body = await daemonsResponse.json() as {
      onlineDaemons: Array<{ daemonId: string }>;
      profiles: Array<{ id: string; online?: boolean }>;
    };

    expect(body.onlineDaemons.some((item) => item.daemonId === 'daemon-online-1')).toBe(true);

    const profile = body.profiles.find((item) => item.id === 'profile-1');
    expect(profile?.online).toBe(true);
  });
});
