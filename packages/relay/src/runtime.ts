import * as os from 'node:os';
import * as path from 'node:path';
import { DeviceRegistry } from './device-registry.js';
import { MessageRouter } from './message-router.js';
import { WebSocketHandler } from './websocket-handler.js';
import { LoginBruteforceGuard } from './auth/bruteforce.js';
import { hashPassword } from './auth/password.js';
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

  const storage = new RelayStorage(dbPath, masterKey);
  ensureDefaultAdmin(storage);

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

function ensureDefaultAdmin(storage: RelayStorage): void {
  const existingAdmin = storage.getAdmin();
  if (existingAdmin) {
    return;
  }

  storage.upsertAdmin('admin', hashPassword('mytermux'), true);
  console.warn('[Relay] 首次初始化默认管理员账号: admin / mytermux（首次登录后必须修改账号和密码）');
}
