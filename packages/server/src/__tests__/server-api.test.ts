import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceRegistry } from '../device-registry';
import { createServer } from '../server';
import { WsTicketService } from '../auth/ws-ticket';
import { RelayStorage } from '../storage';
import { WebAuthStorage } from '../web-auth-storage';

interface TestContext {
  tmpDir: string;
  deviceRegistry: DeviceRegistry;
  storage: RelayStorage;
  webAuthStorage: WebAuthStorage;
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mytermux-server-api-'));
  const storage = new RelayStorage(path.join(tmpDir, 'relay.db'), 'test-master-key');
  const webAuthStorage = new WebAuthStorage(path.join(tmpDir, 'web.db'));

  const deviceRegistry = new DeviceRegistry();
  const wsTicketService = new WsTicketService();

  const app = createServer({
    deviceRegistry,
    storage,
    webAuthStorage,
    wsTicketService,
  });

  const context: TestContext = {
    tmpDir,
    storage,
    webAuthStorage,
    deviceRegistry,
    wsTicketService,
    app,
  };
  contexts.push(context);
  return context;
}

function createMockWs() {
  return {
    close: () => undefined,
    send: () => undefined,
    readyState: 1,
  } as unknown as import('ws').WebSocket;
}

async function managementHeaders(app: ReturnType<typeof createServer>): Promise<Record<string, string>> {
  const loginResponse = await app.request('/api/web-auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      username: 'admin',
      password: 'mytermux',
    }),
  });
  expect(loginResponse.status).toBe(200);

  const rawCookie = loginResponse.headers.get('set-cookie');
  expect(rawCookie).toBeTruthy();
  if (!rawCookie) {
    return {};
  }
  const cookie = rawCookie.split(';')[0]?.trim() || '';
  expect(cookie).toContain('mytermux_web_session=');
  return { cookie };
}

describe('Relay API integration', () => {
  it('should complete auto-profile -> patch -> ws-ticket flow', async () => {
    const { app, wsTicketService, deviceRegistry } = createTestContext();
    const headers = await managementHeaders(app);
    deviceRegistry.registerDevice(
      createMockWs(),
      'daemon-1',
      'daemon',
      'daemon-public-key-1',
      'mytermux-1234567890abcdef1234567890abcdef',
    );

    const daemonsResponse = await app.request('/api/daemons', { headers });
    expect(daemonsResponse.status).toBe(200);
    const daemonsBody = await daemonsResponse.json() as {
      profiles: Array<{ id: string; daemonId?: string | null }>;
    };
    const profile = daemonsBody.profiles.find((item) => item.daemonId === 'daemon-1');
    expect(profile?.id).toBeDefined();

    const patchResponse = await app.request(`/api/daemon-profiles/${profile!.id}`, {
      method: 'PATCH',
      headers: {
        ...headers,
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
        ...headers,
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

  it('should reject daemon apis without web session', async () => {
    const { app } = createTestContext();
    const response = await app.request('/api/daemons');
    expect(response.status).toBe(401);
  });

  it('should allow daemon apis after web login session established', async () => {
    const { app, deviceRegistry } = createTestContext();
    const headers = await managementHeaders(app);

    deviceRegistry.registerDevice(
      createMockWs(),
      'daemon-online-1',
      'daemon',
      'daemon-public-key',
      'mytermux-aabbccddeeff00112233445566778899',
    );

    const daemonsResponse = await app.request('/api/daemons', { headers });
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
    const headers = await managementHeaders(app);

    deviceRegistry.registerDevice(
      createMockWs(),
      'daemon-offline-cleanup',
      'daemon',
      'daemon-public-key-offline-cleanup',
      'mytermux-1029384756abcdef0011223344556677',
    );

    const firstResponse = await app.request('/api/daemons', { headers });
    expect(firstResponse.status).toBe(200);
    const firstBody = await firstResponse.json() as { profiles: Array<{ id: string; daemonId?: string | null }> };
    const profile = firstBody.profiles.find((item) => item.daemonId === 'daemon-offline-cleanup');
    expect(profile?.id).toBeDefined();

    const daemon = deviceRegistry.getDevice('daemon-offline-cleanup');
    expect(daemon).not.toBeNull();
    if (daemon) {
      deviceRegistry.unregisterDevice('daemon-offline-cleanup');
    }

    const secondResponse = await app.request('/api/daemons', { headers });
    expect(secondResponse.status).toBe(200);
    const secondBody = await secondResponse.json() as { profiles: Array<{ id: string; daemonId?: string | null; online?: boolean }> };
    const retained = secondBody.profiles.find((item) => item.id === profile!.id);
    expect(retained?.daemonId).toBe('daemon-offline-cleanup');
    expect(retained?.online).toBe(false);
    expect(storage.getDaemonProfile(profile!.id)?.daemonId).toBe('daemon-offline-cleanup');

    const deleteResponse = await app.request(`/api/daemon-profiles/${profile!.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(deleteResponse.status).toBe(200);
    expect(storage.getDaemonProfile(profile!.id)).toBeNull();
  });

  it('should disable create/bind apis and only allow deleting offline profile', async () => {
    const { app, deviceRegistry } = createTestContext();
    const headers = await managementHeaders(app);

    deviceRegistry.registerDevice(
      createMockWs(),
      'daemon-disabled-api',
      'daemon',
      'daemon-public-key-disabled-api',
      'mytermux-5566778899aabbccddeeff0011223344',
    );

    const daemonsResponse = await app.request('/api/daemons', { headers });
    expect(daemonsResponse.status).toBe(200);
    const body = await daemonsResponse.json() as { profiles: Array<{ id: string; daemonId?: string | null }> };
    const profile = body.profiles.find((item) => item.daemonId === 'daemon-disabled-api');
    expect(profile?.id).toBeDefined();

    const createResponse = await app.request('/api/daemon-profiles', {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'manual' }),
    });
    expect(createResponse.status).toBe(405);

    const bindResponse = await app.request(`/api/daemon-profiles/${profile!.id}/bind`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ daemonId: 'another-daemon' }),
    });
    expect(bindResponse.status).toBe(405);

    const deleteOnlineResponse = await app.request(`/api/daemon-profiles/${profile!.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(deleteOnlineResponse.status).toBe(409);

    const daemon = deviceRegistry.getDevice('daemon-disabled-api');
    expect(daemon).not.toBeNull();
    if (daemon) {
      deviceRegistry.unregisterDevice('daemon-disabled-api');
    }

    const deleteOfflineResponse = await app.request(`/api/daemon-profiles/${profile!.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(deleteOfflineResponse.status).toBe(200);
  });

  it('should reject daemonId updates in patch api', async () => {
    const { app, deviceRegistry } = createTestContext();
    const headers = await managementHeaders(app);
    deviceRegistry.registerDevice(
      createMockWs(),
      'daemon-immutable-id',
      'daemon',
      'daemon-public-key-immutable-id',
      'mytermux-99887766554433221100ffeeddccbbaa',
    );

    const daemonsResponse = await app.request('/api/daemons', { headers });
    expect(daemonsResponse.status).toBe(200);
    const body = await daemonsResponse.json() as { profiles: Array<{ id: string; daemonId?: string | null }> };
    const profile = body.profiles.find((item) => item.daemonId === 'daemon-immutable-id');
    expect(profile?.id).toBeDefined();

    const patchResponse = await app.request(`/api/daemon-profiles/${profile!.id}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        daemonId: 'tampered-daemon-id',
      }),
    });

    expect(patchResponse.status).toBe(400);
    const patchBody = await patchResponse.json() as { error?: string };
    expect(patchBody.error).toBe('IMMUTABLE_FIELD');
  });

  it('should require web session for management and ws-ticket endpoints', async () => {
    const { app, deviceRegistry } = createTestContext();
    deviceRegistry.registerDevice(
      createMockWs(),
      'daemon-link-token-check',
      'daemon',
      'daemon-public-key-link-token-check',
      'mytermux-11223344556677889900aabbccddeeff',
    );

    const deniedDaemonsResponse = await app.request('/api/daemons');
    expect(deniedDaemonsResponse.status).toBe(401);

    const headers = await managementHeaders(app);
    const daemonsResponse = await app.request('/api/daemons', { headers });
    expect(daemonsResponse.status).toBe(200);
    const body = await daemonsResponse.json() as { profiles: Array<{ id: string; daemonId?: string | null }> };
    const profile = body.profiles.find((item) => item.daemonId === 'daemon-link-token-check');
    expect(profile?.id).toBeDefined();

    const patchWithoutToken = await app.request(`/api/daemon-profiles/${profile!.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'daemon-link-token-check-updated',
      }),
    });
    expect(patchWithoutToken.status).toBe(401);

    const patchWithToken = await app.request(`/api/daemon-profiles/${profile!.id}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'daemon-link-token-check-updated',
        accessToken: 'mytermux-11223344556677889900aabbccddeeff',
      }),
    });
    expect(patchWithToken.status).toBe(200);

    const wsTicketResponse = await app.request('/api/ws-ticket', {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profileId: profile!.id,
      }),
    });
    expect(wsTicketResponse.status).toBe(200);
  });
});
