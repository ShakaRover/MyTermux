import { randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { RelayStorage, WebSessionRecord } from '../storage/index.js';
import { generateCsrfToken } from './csrf.js';

/** 会话 Cookie 名 */
export const WEB_SESSION_COOKIE_NAME = 'mytermux_web_session';
/** CSRF Cookie 名 */
export const WEB_CSRF_COOKIE_NAME = 'mytermux_csrf_token';
/** 会话有效期（12 小时） */
export const WEB_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Web 会话服务 */
export class WebSessionService {
  private readonly storage: RelayStorage;

  constructor(storage: RelayStorage) {
    this.storage = storage;
  }

  /** 创建新会话并写入 Cookie */
  createSession(
    c: Context,
    username: string,
    ip: string,
    userAgent: string | null,
  ): WebSessionRecord {
    this.storage.deleteExpiredSessions();

    const now = Date.now();
    const sessionId = generateSessionId();
    const csrfToken = generateCsrfToken();
    const expiresAt = now + WEB_SESSION_TTL_MS;

    const session = this.storage.createSession({
      sessionId,
      username,
      csrfToken,
      ip,
      userAgent,
      expiresAt,
    });

    this.writeSessionCookies(c, session.sessionId, session.csrfToken, session.expiresAt);

    return session;
  }

  /** 从请求读取当前会话 */
  getSession(c: Context): WebSessionRecord | null {
    this.storage.deleteExpiredSessions();

    const sessionId = getCookie(c, WEB_SESSION_COOKIE_NAME);
    if (!sessionId) {
      return null;
    }

    const session = this.storage.getSession(sessionId);
    if (!session) {
      this.clearCookies(c);
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      this.storage.deleteSession(session.sessionId);
      this.clearCookies(c);
      return null;
    }

    return session;
  }

  /** 退出登录并清理会话 */
  destroySession(c: Context): void {
    const sessionId = getCookie(c, WEB_SESSION_COOKIE_NAME);
    if (sessionId) {
      this.storage.deleteSession(sessionId);
    }
    this.clearCookies(c);
  }

  /** 刷新 CSRF Cookie（会话内固定 token） */
  writeCsrfCookie(c: Context, csrfToken: string): void {
    setCookie(c, WEB_CSRF_COOKIE_NAME, csrfToken, {
      path: '/',
      sameSite: 'Strict',
      secure: isSecureRequest(c),
      httpOnly: false,
      maxAge: Math.floor(WEB_SESSION_TTL_MS / 1000),
    });
  }

  private writeSessionCookies(c: Context, sessionId: string, csrfToken: string, expiresAt: number): void {
    setCookie(c, WEB_SESSION_COOKIE_NAME, sessionId, {
      path: '/',
      sameSite: 'Strict',
      secure: isSecureRequest(c),
      httpOnly: true,
      expires: new Date(expiresAt),
      maxAge: Math.floor(WEB_SESSION_TTL_MS / 1000),
    });

    this.writeCsrfCookie(c, csrfToken);
  }

  private clearCookies(c: Context): void {
    deleteCookie(c, WEB_SESSION_COOKIE_NAME, {
      path: '/',
      sameSite: 'Strict',
      secure: isSecureRequest(c),
      httpOnly: true,
    });

    deleteCookie(c, WEB_CSRF_COOKIE_NAME, {
      path: '/',
      sameSite: 'Strict',
      secure: isSecureRequest(c),
      httpOnly: false,
    });
  }
}

/** 生成会话 ID */
function generateSessionId(): string {
  return randomBytes(24).toString('base64url');
}

/** 是否应设置 Secure Cookie */
function isSecureRequest(c: Context): boolean {
  const forwardedProto = c.req.header('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim() === 'https';
  }

  try {
    return new URL(c.req.url).protocol === 'https:';
  } catch {
    return false;
  }
}
