import * as os from 'node:os';
import * as path from 'node:path';
import * as fsSync from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DeviceRegistry } from './device-registry.js';
import { MessageRouter } from './message-router.js';
import { WebSocketHandler } from './websocket-handler.js';
import { WsTicketService } from './auth/ws-ticket.js';
import { createServer } from './server.js';
import { RelayStorage } from './storage/index.js';
import { WebAuthStorage } from './web-auth-storage.js';

/** Server 运行时组件 */
export interface RelayRuntime {
  deviceRegistry: DeviceRegistry;
  messageRouter: MessageRouter;
  wsHandler: WebSocketHandler;
  app: ReturnType<typeof createServer>;
  storage: RelayStorage;
  webAuthStorage: WebAuthStorage;
  wsTicketService: WsTicketService;
}

/** 初始化 Server 全量运行时组件 */
export function initializeRelayRuntime(): RelayRuntime {
  const dbPath = process.env['SERVER_DB_PATH'] || path.join(os.homedir(), '.mytermux', 'relay.db');
  const webDbPath = process.env['WEB_DB_PATH'] || path.join(os.homedir(), '.mytermux', 'web.db');
  const webDistDir = resolveWebDistDir();
  const masterKey = process.env['SERVER_MASTER_KEY'] || 'mytermux-dev-master-key';
  const daemonLinkToken = process.env['MYTERMUX_DAEMON_LINK_TOKEN']?.trim() || undefined;
  const webAdminUsername = process.env['WEB_ADMIN_USERNAME']?.trim() || undefined;
  const webAdminPassword = process.env['WEB_ADMIN_PASSWORD'] || undefined;

  if (!process.env['SERVER_MASTER_KEY']) {
    console.warn('[Server] 未设置 SERVER_MASTER_KEY，当前使用开发默认值，请勿用于生产环境');
  }

  const storage = new RelayStorage(dbPath, masterKey);
  const webAuthStorage = new WebAuthStorage(webDbPath, {
    ...(webAdminUsername ? { adminUsername: webAdminUsername } : {}),
    ...(webAdminPassword ? { adminPassword: webAdminPassword } : {}),
  });
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
    webAuthStorage,
    wsTicketService,
    ...(webDistDir ? { webDistDir } : {}),
  });

  return {
    deviceRegistry,
    messageRouter,
    wsHandler,
    app,
    storage,
    webAuthStorage,
    wsTicketService,
  };
}

function resolveWebDistDir(): string | undefined {
  const envDir = process.env['SERVER_WEB_DIST_DIR']?.trim();
  if (envDir) {
    const resolved = path.resolve(envDir);
    if (hasIndexHtml(resolved)) {
      return resolved;
    }
    console.warn(`[Server] SERVER_WEB_DIST_DIR 无效，未找到 index.html: ${resolved}`);
  }

  const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), 'packages/web/dist'),
    path.resolve(runtimeDir, '../../web/dist'),
  ];

  for (const candidate of candidates) {
    if (hasIndexHtml(candidate)) {
      return candidate;
    }
  }

  console.warn('[Server] 未找到 Web 构建产物，根路径将不提供前端页面');
  return undefined;
}

function hasIndexHtml(dirPath: string): boolean {
  return fsSync.existsSync(path.join(dirPath, 'index.html'));
}
