import * as os from 'node:os';
import * as path from 'node:path';
import { DeviceRegistry } from './device-registry.js';
import { MessageRouter } from './message-router.js';
import { WebSocketHandler } from './websocket-handler.js';
import { LoginBruteforceGuard } from './auth/bruteforce.js';
import { hashPassword, isScryptHash } from './auth/password.js';
import { WebSessionService } from './auth/session.js';
import { WsTicketService } from './auth/ws-ticket.js';
import { createServer } from './server.js';
import { RelayStorage } from './storage/index.js';

/** Relay 运行时组件 */
export interface RelayRuntime {
  deviceRegistry: DeviceRegistry;
  messageRouter: MessageRouter;
  wsHandler: WebSocketHandler;
  app: ReturnType<typeof createServer>;
  storage: RelayStorage;
  sessionService: WebSessionService;
  loginGuard: LoginBruteforceGuard;
  wsTicketService: WsTicketService;
}

/** 初始化 Relay 全量运行时组件 */
export function initializeRelayRuntime(): RelayRuntime {
  const dbPath = process.env['RELAY_DB_PATH'] || path.join(os.homedir(), '.mytermux', 'relay.db');
  const masterKey = process.env['RELAY_WEB_MASTER_KEY'] || 'mytermux-dev-master-key';
  const webLinkToken = process.env['MYTERMUX_WEB_LINK_TOKEN']?.trim() || undefined;
  const daemonLinkToken = process.env['MYTERMUX_DAEMON_LINK_TOKEN']?.trim() || undefined;

  if (!process.env['RELAY_WEB_MASTER_KEY']) {
    console.warn('[Relay] 未设置 RELAY_WEB_MASTER_KEY，当前使用开发默认值，请勿用于生产环境');
  }

  const adminUsername = process.env['RELAY_ADMIN_USERNAME']?.trim() || 'admin';
  const passwordHash = resolveAdminPasswordHash();

  const storage = new RelayStorage(dbPath, masterKey);
  storage.upsertAdmin(adminUsername, passwordHash);

  const sessionService = new WebSessionService(storage);
  const loginGuard = new LoginBruteforceGuard(storage);
  const wsTicketService = new WsTicketService();

  const deviceRegistry = new DeviceRegistry();
  const messageRouter = new MessageRouter(deviceRegistry);
  const wsHandler = new WebSocketHandler(
    deviceRegistry,
    messageRouter,
    wsTicketService,
    { ...(daemonLinkToken ? { daemonLinkToken } : {}) },
  );
  const app = createServer({
    deviceRegistry,
    storage,
    sessionService,
    loginGuard,
    wsTicketService,
    ...(webLinkToken ? { webLinkToken } : {}),
  });

  return {
    deviceRegistry,
    messageRouter,
    wsHandler,
    app,
    storage,
    sessionService,
    loginGuard,
    wsTicketService,
  };
}

function resolveAdminPasswordHash(): string {
  const inputHash = process.env['RELAY_ADMIN_PASSWORD_HASH']?.trim();
  if (inputHash) {
    if (!isScryptHash(inputHash)) {
      throw new Error('RELAY_ADMIN_PASSWORD_HASH 格式非法，应为 scrypt$N$r$p$saltB64$hashB64');
    }
    return inputHash;
  }

  const defaultPassword = 'mytermux';
  console.warn('[Relay] 未设置 RELAY_ADMIN_PASSWORD_HASH，使用默认管理员密码: mytermux（仅开发环境）');
  return hashPassword(defaultPassword);
}
