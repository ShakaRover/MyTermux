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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mytermux-relay-api-'));
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

async function loginAndGetAuth(app: ReturnType<typeof createServer>): Promise<{ cookies: string; csrfToken: string }> {
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

  const csrfResponse = await app.request('/api/web-auth/csrf', {
    headers: {
      cookie: cookies,
    },
  });

  expect(csrfResponse.status).toBe(200);
  const csrfBody = await csrfResponse.json() as { csrfToken: string };

  return {
    cookies,
    csrfToken: csrfBody.csrfToken,
  };
}

describe('Relay API integration', () => {
  it('should complete login -> csrf -> auto-profile -> patch -> ws-ticket flow', async () => {
    const { app, wsTicketService, deviceRegistry } = createTestContext();
    deviceRegistry.registerDevice(
      createMockWs(),
      'daemon-1',
      'daemon',
      'daemon-public-key-1',
      'mytermux-1234567890abcdef1234567890abcdef',
    );

    const { cookies, csrfToken } = await loginAndGetAuth(app);
    expect(cookies.includes('mytermux_web_session=')).toBe(true);

    const daemonsResponse = await app.request('/api/daemons', {
      headers: { cookie: cookies },
    });
    expect(daemonsResponse.status).toBe(200);
    const daemonsBody = await daemonsResponse.json() as {
      profiles: Array<{ id: string; daemonId?: string | null }>;
    };
    const profile = daemonsBody.profiles.find((item) => item.daemonId === 'daemon-1');
    expect(profile?.id).toBeDefined();

    const patchResponse = await app.request(`/api/daemon-profiles/${profile!.id}`, {
      method: 'PATCH',
      headers: {
        cookie: cookies,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'daemon-1-customized',
        accessToken: 'mytermux-1234567890abcdef1234567890abcdef',
        defaultCommandMode: 'tmux',
      }),
    });
    expect(patchResponse.status).toBe(200);

    const wsTicketResponse = await app.request('/api/ws-ticket', {
      method: 'POST',
      headers: {
        cookie: cookies,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profileId: profile!.id,
      }),
    });

    expect(wsTicketResponse.status).toBe(200);
    const wsTicketBody = await wsTicketResponse.json() as { ticket: string; profileId: string };
    expect(wsTicketBody.profileId).toBe(profile!.id);

    const consumed = wsTicketService.consume(wsTicketBody.ticket);
    expect(consumed?.profileId).toBe(profile!.id);
    expect(wsTicketService.consume(wsTicketBody.ticket)).toBeNull();
  });

  it('should reject protected api when unauthenticated', async () => {
    const { app } = createTestContext();

    const response = await app.request('/api/daemons');
    expect(response.status).toBe(401);
  });

  it('should enforce csrf for write operations', async () => {
    const { app, deviceRegistry } = createTestContext();
    deviceRegistry.registerDevice(
      createMockWs(),
      'daemon-csrf-check',
      'daemon',
      'daemon-public-key-csrf-check',
      'mytermux-0f0e0d0c0b0a09080706050403020100',
    );

    const { cookies } = await loginAndGetAuth(app);
    const daemonsResponse = await app.request('/api/daemons', {
      headers: { cookie: cookies },
    });
    const body = await daemonsResponse.json() as { profiles: Array<{ id: string }> };
    const profileId = body.profiles[0]?.id;
    expect(profileId).toBeDefined();

    const patchResponse = await app.request(`/api/daemon-profiles/${profileId}`, {
      method: 'PATCH',
      headers: {
        cookie: cookies,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'without-csrf',
      }),
    });

    expect(patchResponse.status).toBe(403);
  });

  it('should auto create profile for online daemon in /api/daemons', async () => {
    const { app, deviceRegistry } = createTestContext();

    deviceRegistry.registerDevice(
      createMockWs(),
      'daemon-online-1',
      'daemon',
      'daemon-public-key',
      'mytermux-aabbccddeeff00112233445566778899',
    );

    const { cookies } = await loginAndGetAuth(app);
    const daemonsResponse = await app.request('/api/daemons', {
      headers: { cookie: cookies },
    });
    expect(daemonsResponse.status).toBe(200);

    const body = await daemonsResponse.json() as {
      onlineDaemons: Array<{ daemonId: string }>;
      profiles: Array<{ daemonId?: string | null; online?: boolean }>;
    };
    expect(body.onlineDaemons.some((item) => item.daemonId === 'daemon-online-1')).toBe(true);
    const profile = body.profiles.find((item) => item.daemonId === 'daemon-online-1');
    expect(profile?.online).toBe(true);
  });

  it('should keep profile when daemon goes offline until manual delete', async () => {
    const { app, deviceRegistry, storage } = createTestContext();

    deviceRegistry.registerDevice(
      createMockWs(),
      'daemon-offline-cleanup',
      'daemon',
      'daemon-public-key-offline-cleanup',
      'mytermux-1029384756abcdef0011223344556677',
    );

    const { cookies } = await loginAndGetAuth(app);

    const firstResponse = await app.request('/api/daemons', {
      headers: { cookie: cookies },
    });
    expect(firstResponse.status).toBe(200);
    let firstBody = await firstResponse.json() as { profiles: Array<{ daemonId?: string | null }> };
    expect(firstBody.profiles.some((item) => item.daemonId === 'daemon-offline-cleanup')).toBe(true);

    deviceRegistry.unregisterDevice('daemon-offline-cleanup');

    const secondResponse = await app.request('/api/daemons', {
      headers: { cookie: cookies },
    });
    expect(secondResponse.status).toBe(200);
    firstBody = await secondResponse.json() as { profiles: Array<{ daemonId?: string | null }> };
    expect(firstBody.profiles.some((item) => item.daemonId === 'daemon-offline-cleanup')).toBe(true);
    expect(storage.getDaemonProfileByDaemonId('daemon-offline-cleanup')).not.toBeNull();
  });

  it('should disable create/bind APIs and only allow deleting offline profile', async () => {
    const { app, deviceRegistry } = createTestContext();
    deviceRegistry.registerDevice(
      createMockWs(),
      'daemon-disabled-api',
      'daemon',
      'daemon-public-key-disabled-api',
      'mytermux-8899aabbccddeeff0011223344556677',
    );

    const { cookies, csrfToken } = await loginAndGetAuth(app);
    const daemonsResponse = await app.request('/api/daemons', {
      headers: { cookie: cookies },
    });
    const daemonsBody = await daemonsResponse.json() as { profiles: Array<{ id: string }> };
    const profileId = daemonsBody.profiles[0]?.id;
    expect(profileId).toBeDefined();

    const createResponse = await app.request('/api/daemon-profiles', {
      method: 'POST',
      headers: {
        cookie: cookies,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'should-be-disabled',
        daemonId: 'daemon-disabled-api',
        defaultCommandMode: 'zsh',
      }),
    });
    expect(createResponse.status).toBe(405);

    const deleteResponse = await app.request(`/api/daemon-profiles/${profileId}`, {
      method: 'DELETE',
      headers: {
        cookie: cookies,
        'x-csrf-token': csrfToken,
      },
    });
    expect(deleteResponse.status).toBe(409);

    deviceRegistry.unregisterDevice('daemon-disabled-api');

    const deleteOfflineResponse = await app.request(`/api/daemon-profiles/${profileId}`, {
      method: 'DELETE',
      headers: {
        cookie: cookies,
        'x-csrf-token': csrfToken,
      },
    });
    expect(deleteOfflineResponse.status).toBe(200);

    const bindResponse = await app.request(`/api/daemon-profiles/${profileId}/bind`, {
      method: 'POST',
      headers: {
        cookie: cookies,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        daemonId: 'daemon-disabled-api',
      }),
    });
    expect(bindResponse.status).toBe(405);
  });

  it('should reject daemonId updates in patch API', async () => {
    const { app, storage } = createTestContext();
    storage.createDaemonProfile('profile-immutable-daemon-id', {
      name: 'immutable-daemon-id',
      daemonId: 'daemon-origin',
      defaultCommandMode: 'zsh',
    });

    const { cookies, csrfToken } = await loginAndGetAuth(app);
    const response = await app.request('/api/daemon-profiles/profile-immutable-daemon-id', {
      method: 'PATCH',
      headers: {
        cookie: cookies,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        daemonId: 'daemon-new',
      }),
    });

    expect(response.status).toBe(400);
  });

});
