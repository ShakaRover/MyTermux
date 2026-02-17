import type { Context, MiddlewareHandler } from 'hono';
import type { WebSessionRecord } from '../storage/index.js';
import { WebSessionService } from './session.js';

/** Hono Context 注入变量 */
export interface AuthVariables {
  webSession: WebSessionRecord;
}

/** 获取请求来源 IP（优先代理头） */
export function getClientIp(c: Context): string {
  const xForwardedFor = c.req.header('x-forwarded-for');
  if (xForwardedFor) {
    const first = xForwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }

  const xRealIp = c.req.header('x-real-ip');
  if (xRealIp) return xRealIp;

  const cfConnectingIp = c.req.header('cf-connecting-ip');
  if (cfConnectingIp) return cfConnectingIp;

  return 'unknown';
}

/** 要求已登录 */
export function requireWebSession(sessionService: WebSessionService): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const session = sessionService.getSession(c);
    if (!session) {
      return c.json({ error: 'UNAUTHORIZED', message: '请先登录' }, 401);
    }

    c.set('webSession', session);
    await next();
  };
}

/** 要求 CSRF Header 与会话 token 一致 */
export function requireCsrfToken(): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const session = c.get('webSession');
    const headerToken = c.req.header('x-csrf-token');

    if (!headerToken || headerToken !== session.csrfToken) {
      return c.json({ error: 'CSRF_INVALID', message: 'CSRF 校验失败' }, 403);
    }

    await next();
  };
}
