/**
 * Hono 服务器配置
 *
 * 功能：
 * - HTTP: Relay 健康检查与信息页
 * - API: Web 认证、Daemon Profile 管理、Web 偏好配置、ws-ticket
 * - WebSocket 升级: GET /ws
 */

import { randomUUID } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import type { DefaultCommandMode, WebShortcut } from '@mytermux/shared';
import type { DeviceRegistry } from './device-registry.js';
import type { RelayStorage, DaemonProfilePatch } from './storage/index.js';
import { LoginBruteforceGuard } from './auth/bruteforce.js';
import { requireCsrfToken, requireWebSession, type AuthVariables, getClientIp } from './auth/middleware.js';
import { verifyPassword } from './auth/password.js';
import { WebSessionService } from './auth/session.js';
import type { WsTicketService } from './auth/ws-ticket.js';

/** 服务器选项 */
export interface ServerOptions {
  /** 设备注册管理器（用于健康检查统计 + 在线 daemon 聚合） */
  deviceRegistry?: DeviceRegistry;
  /** SQLite 存储层 */
  storage?: RelayStorage;
  /** 登录会话服务 */
  sessionService?: WebSessionService;
  /** 暴力破解防护 */
  loginGuard?: LoginBruteforceGuard;
  /** ws-ticket 签发器 */
  wsTicketService?: WsTicketService;
  /** Web -> Relay 链接 token（MYTERMUX_WEB_LINK_TOKEN） */
  webLinkToken?: string;
}

/** 允许的默认命令模式 */
const VALID_COMMAND_MODES: DefaultCommandMode[] = ['zsh', 'bash', 'tmux', 'custom'];

/**
 * 创建 Hono 应用
 */
export function createServer(options: ServerOptions = {}) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const requireSession = createRequireSessionMiddleware(options.sessionService);

  // 中间件
  app.use('*', cors());

  // 健康检查
  app.get('/health', (c) => {
    const stats = options.deviceRegistry?.getStats();

    return c.json({
      status: 'ok',
      timestamp: Date.now(),
      version: '1.0.0',
      connections: stats ?? { daemons: 0, clients: 0, accessTokens: 0 },
    });
  });

  // WebSocket 升级端点
  app.get('/ws', (c) => {
    return c.text('WebSocket endpoint - upgrade required', 426);
  });

  // Web Auth - 登录
  app.post('/api/web-auth/login', async (c) => {
    const storage = options.storage;
    const sessionService = options.sessionService;
    const loginGuard = options.loginGuard;

    if (!storage || !sessionService || !loginGuard) {
      return c.json({ error: 'SERVICE_UNAVAILABLE', message: 'Web Auth 未初始化' }, 503);
    }

    const body = await parseJson<{ username?: string; password?: string }>(c);
    const username = body?.username?.trim();
    const password = body?.password?.trim() ?? '';
    if (!username || !password) {
      return c.json({ error: 'INVALID_INPUT', message: '用户名和密码不能为空' }, 400);
    }

    const ip = getClientIp(c);
    const guard = loginGuard.check(ip, username);
    if (!guard.allowed) {
      return c.json(
        {
          error: 'AUTH_THROTTLED',
          message: '登录失败，请稍后重试',
          retryAfterSeconds: guard.retryAfterSeconds,
        },
        429,
      );
    }

    const admin = storage.getAdminByUsername(username);
    const passwordMatched = admin ? safeVerifyPassword(password, admin.passwordHash) : false;

    if (!passwordMatched) {
      loginGuard.recordFailure(ip, username);
      return c.json({ error: 'AUTH_FAILED', message: '用户名或密码错误' }, 401);
    }

    loginGuard.recordSuccess(ip, username);

    const session = sessionService.createSession(
      c,
      username,
      ip,
      c.req.header('user-agent') ?? null,
    );

    return c.json({
      success: true,
      authenticated: true,
      username,
      expiresAt: session.expiresAt,
    });
  });

  // Web Auth - 退出
  app.post('/api/web-auth/logout', requireSession, requireCsrfToken(), (c) => {
    options.sessionService?.destroySession(c);
    return c.json({ success: true });
  });

  // Web Auth - 当前会话
  app.get('/api/web-auth/me', requireSession, (c) => {
    const session = c.get('webSession');
    return c.json({
      authenticated: true,
      username: session.username,
      expiresAt: session.expiresAt,
    });
  });

  // Web Auth - 获取 CSRF token
  app.get('/api/web-auth/csrf', requireSession, (c) => {
    const session = c.get('webSession');
    options.sessionService?.writeCsrfCookie(c, session.csrfToken);

    return c.json({ csrfToken: session.csrfToken });
  });

  // Daemon 管理 - 在线+配置聚合
  app.get('/api/daemons', requireSession, (c) => {
    const storage = options.storage;
    if (!storage) {
      return c.json({ error: 'SERVICE_UNAVAILABLE', message: '存储未初始化' }, 503);
    }

    const onlineDaemons = options.deviceRegistry?.getOnlineDaemons() ?? [];
    syncDaemonProfilesWithOnlineDaemons(storage, onlineDaemons);

    const onlineById = new Map(onlineDaemons.map((item) => [item.daemonId, item]));

    const profiles = storage.listDaemonProfiles().map((profile) => {
      const matched = profile.daemonId ? onlineById.get(profile.daemonId) : undefined;
      return {
        ...profile,
        online: !!matched,
        ...(matched && {
          lastHeartbeat: matched.lastHeartbeat,
          connectedClients: matched.connectedClients,
        }),
      };
    });

    return c.json({ onlineDaemons, profiles });
  });

  // Daemon Profile - 新增
  app.post(
    '/api/daemon-profiles',
    requireSession,
    requireCsrfToken(),
    async (c) => {
      return c.json({ error: 'API_DISABLED', message: 'profile 为 daemonId 自动创建，不支持手动新增' }, 405);
    },
  );

  // Daemon Profile - 更新
  app.patch(
    '/api/daemon-profiles/:id',
    requireSession,
    requireCsrfToken(),
    async (c) => {
      const storage = options.storage;
      if (!storage) {
        return c.json({ error: 'SERVICE_UNAVAILABLE', message: '存储未初始化' }, 503);
      }

      const profileId = c.req.param('id');
      const body = await parseJson<Record<string, unknown>>(c);

      if (body && Object.prototype.hasOwnProperty.call(body, 'daemonId')) {
        return c.json({ error: 'IMMUTABLE_FIELD', message: 'daemonId 创建后不可修改' }, 400);
      }

      const profile = storage.getDaemonProfile(profileId);
      if (!profile) {
        return c.json({ error: 'NOT_FOUND', message: 'daemon profile 不存在' }, 404);
      }

      const onlineDaemonIds = new Set((options.deviceRegistry?.getOnlineDaemons() ?? []).map((item) => item.daemonId));
      if (!profile.daemonId || !onlineDaemonIds.has(profile.daemonId)) {
        return c.json({ error: 'PROFILE_OFFLINE', message: '离线 daemon 的配置仅支持手动删除' }, 409);
      }

      const patch = parsePatchProfileInput(body);

      if (!patch) {
        return c.json({ error: 'INVALID_INPUT', message: 'daemon profile 更新参数无效' }, 400);
      }

      try {
        const profile = storage.updateDaemonProfile(profileId, patch);
        return c.json({ profile });
      } catch (error) {
        return c.json({ error: 'NOT_FOUND', message: toErrorMessage(error) }, 404);
      }
    },
  );

  // Daemon Profile - 删除（仅离线配置允许手动删除）
  app.delete(
    '/api/daemon-profiles/:id',
    requireSession,
    requireCsrfToken(),
    async (c) => {
      const storage = options.storage;
      if (!storage) {
        return c.json({ error: 'SERVICE_UNAVAILABLE', message: '存储未初始化' }, 503);
      }

      const profileId = c.req.param('id');
      const profile = storage.getDaemonProfile(profileId);
      if (!profile) {
        return c.json({ error: 'NOT_FOUND', message: 'daemon profile 不存在' }, 404);
      }

      const onlineDaemonIds = new Set((options.deviceRegistry?.getOnlineDaemons() ?? []).map((item) => item.daemonId));
      if (profile.daemonId && onlineDaemonIds.has(profile.daemonId)) {
        return c.json({ error: 'PROFILE_ONLINE', message: '在线 daemon 的配置不允许删除' }, 409);
      }

      try {
        storage.deleteDaemonProfile(profileId);
        return c.json({ success: true });
      } catch (error) {
        return c.json({ error: 'NOT_FOUND', message: toErrorMessage(error) }, 404);
      }
    },
  );

  // Daemon Profile - 绑定在线 daemonId
  app.post(
    '/api/daemon-profiles/:id/bind',
    requireSession,
    requireCsrfToken(),
    async (c) => {
      return c.json({ error: 'API_DISABLED', message: 'daemonId 与 profile 一一对应，不支持手动绑定' }, 405);
    },
  );

  // ws-ticket（client 连接 /ws 前置）
  app.post(
    '/api/ws-ticket',
    requireSession,
    requireCsrfToken(),
    async (c) => {
      const storage = options.storage;
      const wsTicketService = options.wsTicketService;

      if (!storage || !wsTicketService) {
        return c.json({ error: 'SERVICE_UNAVAILABLE', message: 'ws-ticket 服务未初始化' }, 503);
      }

      const body = await parseJson<{ profileId?: string; webLinkToken?: string }>(c);
      const profileId = body?.profileId?.trim();
      const webLinkToken = body?.webLinkToken?.trim() ?? '';

      if (!profileId) {
        return c.json({ error: 'INVALID_INPUT', message: 'profileId 不能为空' }, 400);
      }
      if (options.webLinkToken && webLinkToken !== options.webLinkToken) {
        return c.json({ error: 'UNAUTHORIZED', message: 'MYTERMUX_WEB_LINK_TOKEN 无效' }, 401);
      }

      const profile = storage.getDaemonProfile(profileId);
      if (!profile) {
        return c.json({ error: 'NOT_FOUND', message: 'daemon profile 不存在' }, 404);
      }

      const daemonToken = storage.getDaemonProfileToken(profileId);
      if (!daemonToken) {
        return c.json({ error: 'TOKEN_MISSING', message: '该 profile 未配置 MYTERMUX_DAEMON_TOKEN' }, 400);
      }

      const ticket = wsTicketService.issue({
        profileId,
        daemonToken,
        ...(profile.daemonId !== undefined && { daemonId: profile.daemonId }),
      });

      return c.json({
        ticket: ticket.ticket,
        expiresAt: ticket.expiresAt,
        profileId,
        daemonId: profile.daemonId ?? null,
      });
    },
  );

  // Web Preferences - 查询
  app.get('/api/web-preferences', requireSession, (c) => {
    const storage = options.storage;
    if (!storage) {
      return c.json({ error: 'SERVICE_UNAVAILABLE', message: '存储未初始化' }, 503);
    }

    return c.json(storage.getWebPreferences());
  });

  // Web Preferences - 更新
  app.put(
    '/api/web-preferences',
    requireSession,
    requireCsrfToken(),
    async (c) => {
      const storage = options.storage;
      if (!storage) {
        return c.json({ error: 'SERVICE_UNAVAILABLE', message: '存储未初始化' }, 503);
      }

      const body = await parseJson<{ shortcuts?: unknown; commonChars?: unknown }>(c);
      const parsed = parseWebPreferencesInput(body?.shortcuts, body?.commonChars);
      if (!parsed) {
        return c.json({ error: 'INVALID_INPUT', message: '快捷键或常用字符配置无效' }, 400);
      }

      const preferences = storage.upsertWebPreferences(parsed.shortcuts, parsed.commonChars);
      return c.json(preferences);
    },
  );

  // API 文档/信息
  app.get('/', (c) => {
    return c.json({
      name: 'MyTermux Relay Server',
      version: '1.0.0',
      endpoints: {
        '/health': 'GET - 健康检查',
        '/ws': 'WebSocket - 设备连接端点',
        '/api/web-auth/login': 'POST - Web 登录',
        '/api/web-auth/logout': 'POST - Web 退出',
        '/api/web-auth/me': 'GET - 当前登录用户',
        '/api/web-auth/csrf': 'GET - 获取 CSRF Token',
        '/api/ws-ticket': 'POST - 签发一次性 ws ticket',
        '/api/daemons': 'GET - 在线 daemon 与 profile 聚合视图',
        '/api/daemon-profiles': 'POST - 已禁用（profile 自动创建）',
        '/api/daemon-profiles/:id': 'PATCH/DELETE - 更新或删除（仅离线可删除）',
        '/api/daemon-profiles/:id/bind': 'POST - 已禁用（不支持手动绑定）',
        '/api/web-preferences': 'GET/PUT - 终端快捷键与常用字符配置',
      },
    });
  });

  return app;
}

function createRequireSessionMiddleware(
  sessionService: WebSessionService | undefined,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  if (!sessionService) {
    return async (c) => {
      return c.json({ error: 'SERVICE_UNAVAILABLE', message: 'Web Auth 未初始化' }, 503);
    };
  }

  return requireWebSession(sessionService);
}

/** 安全包装密码校验，避免 hash 解析异常中断请求 */
function safeVerifyPassword(password: string, hashString: string): boolean {
  try {
    return verifyPassword(password, hashString);
  } catch {
    return false;
  }
}

/** 解析 JSON 请求体 */
async function parseJson<T>(c: Context): Promise<T | null> {
  try {
    return await c.req.json<T>();
  } catch {
    return null;
  }
}

/** 更新 profile 入参校验 */
function parsePatchProfileInput(body: Record<string, unknown> | null): DaemonProfilePatch | null {
  if (!body) {
    return null;
  }

  const patch: DaemonProfilePatch = {};

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    if (typeof body['name'] !== 'string' || !body['name'].trim()) {
      return null;
    }
    patch.name = body['name'].trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'daemonId')) {
    patch.daemonId = normalizeNullableString(body['daemonId']);
  }

  const hasAccessToken = Object.prototype.hasOwnProperty.call(body, 'accessToken');
  const hasDaemonToken = Object.prototype.hasOwnProperty.call(body, 'daemonToken');
  const accessToken = hasAccessToken ? normalizeNullableString(body['accessToken']) : undefined;
  const daemonToken = hasDaemonToken ? normalizeNullableString(body['daemonToken']) : undefined;
  if (hasAccessToken && hasDaemonToken && accessToken !== daemonToken) {
    return null;
  }
  if (hasDaemonToken) {
    patch.accessToken = daemonToken ?? null;
  } else if (hasAccessToken) {
    patch.accessToken = accessToken ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'defaultCwd')) {
    patch.defaultCwd = normalizeNullableString(body['defaultCwd']);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'defaultCommandMode')) {
    const mode = normalizeCommandMode(body['defaultCommandMode']);
    if (!mode) {
      return null;
    }
    patch.defaultCommandMode = mode;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'defaultCommandValue')) {
    patch.defaultCommandValue = normalizeNullableString(body['defaultCommandValue']);
  }

  return patch;
}

/** Web 偏好输入校验 */
function parseWebPreferencesInput(shortcutsInput: unknown, commonCharsInput: unknown): {
  shortcuts: WebShortcut[];
  commonChars: string[];
} | null {
  if (!Array.isArray(shortcutsInput) || !Array.isArray(commonCharsInput)) {
    return null;
  }

  const shortcuts: WebShortcut[] = [];
  for (const item of shortcutsInput) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as Record<string, unknown>)['id'] !== 'string' ||
      typeof (item as Record<string, unknown>)['label'] !== 'string' ||
      typeof (item as Record<string, unknown>)['value'] !== 'string'
    ) {
      return null;
    }

    const record = item as Record<string, unknown>;
    const id = String(record['id']).trim();
    const label = String(record['label']).trim();
    const value = String(record['value']);

    if (!id || !label) {
      return null;
    }

    shortcuts.push({ id, label, value });
  }

  const commonChars = commonCharsInput
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return { shortcuts, commonChars };
}

/** 规范化可空字符串 */
function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** 规范化命令模式 */
function normalizeCommandMode(value: unknown): DefaultCommandMode | null {
  if (typeof value !== 'string') {
    return null;
  }

  return (VALID_COMMAND_MODES as string[]).includes(value)
    ? (value as DefaultCommandMode)
    : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 同步 daemonId 与 profile 的一一映射：
 * - 新在线 daemon 自动创建默认 profile
 * - 离线 daemon 的 profile 保留，等待手动删除
 * - 若同一 daemonId 存在多条 profile，保留一条并清理其余
 * - 清理历史脏数据（daemonId 为空）
 */
function syncDaemonProfilesWithOnlineDaemons(
  storage: RelayStorage,
  onlineDaemons: Array<{ daemonId: string }>,
): void {
  const profiles = storage.listDaemonProfiles();
  const keptDaemonIds = new Set<string>();

  for (const profile of profiles) {
    const daemonId = profile.daemonId?.trim();
    if (!daemonId) {
      storage.deleteDaemonProfile(profile.id);
      continue;
    }

    if (keptDaemonIds.has(daemonId)) {
      storage.deleteDaemonProfile(profile.id);
      continue;
    }

    keptDaemonIds.add(daemonId);
  }

  for (const daemon of onlineDaemons) {
    if (keptDaemonIds.has(daemon.daemonId)) {
      continue;
    }

    storage.createDaemonProfile(randomUUID(), {
      name: daemon.daemonId,
      daemonId: daemon.daemonId,
      defaultCommandMode: 'zsh',
      defaultCwd: null,
      defaultCommandValue: null,
      accessToken: null,
    });
  }
}
