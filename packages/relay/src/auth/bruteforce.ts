import type { RelayStorage } from '../storage/index.js';

/** 登录保护判定结果 */
export interface LoginGuardResult {
  allowed: boolean;
  reason?: 'ip_rate_limited' | 'account_locked';
  retryAfterSeconds?: number;
}

/** 登录失败防护配置 */
const IP_SCOPE_USERNAME = '__ip_scope__';
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_ATTEMPTS = 30;
const ACCOUNT_LOCK_THRESHOLD = 5;
const ACCOUNT_BASE_LOCK_MS = 5 * 60 * 1000;
const ACCOUNT_MAX_LOCK_MS = 60 * 60 * 1000;

/** 持久化暴力破解防护器 */
export class LoginBruteforceGuard {
  private readonly storage: RelayStorage;

  constructor(storage: RelayStorage) {
    this.storage = storage;
  }

  /** 检查当前请求是否允许继续登录 */
  check(ip: string, username: string, now = Date.now()): LoginGuardResult {
    const ipAttempt = this.storage.getLoginAttempt(ip, IP_SCOPE_USERNAME);
    if (ipAttempt && now - ipAttempt.windowStart <= IP_WINDOW_MS && ipAttempt.failedCount >= IP_MAX_ATTEMPTS) {
      return {
        allowed: false,
        reason: 'ip_rate_limited',
        retryAfterSeconds: Math.max(1, Math.ceil((ipAttempt.windowStart + IP_WINDOW_MS - now) / 1000)),
      };
    }

    const accountAttempt = this.storage.getLoginAttempt(ip, username);
    if (accountAttempt?.lockUntil && accountAttempt.lockUntil > now) {
      return {
        allowed: false,
        reason: 'account_locked',
        retryAfterSeconds: Math.max(1, Math.ceil((accountAttempt.lockUntil - now) / 1000)),
      };
    }

    return { allowed: true };
  }

  /** 记录登录失败 */
  recordFailure(ip: string, username: string, now = Date.now()): void {
    this.recordIpFailure(ip, now);
    this.recordAccountFailure(ip, username, now);
  }

  /** 登录成功后清理失败计数 */
  recordSuccess(ip: string, username: string): void {
    this.storage.deleteLoginAttempt(ip, IP_SCOPE_USERNAME);
    this.storage.deleteLoginAttempt(ip, username);
  }

  private recordIpFailure(ip: string, now: number): void {
    const existing = this.storage.getLoginAttempt(ip, IP_SCOPE_USERNAME);

    if (!existing || now - existing.windowStart > IP_WINDOW_MS) {
      this.storage.upsertLoginAttempt({
        ip,
        username: IP_SCOPE_USERNAME,
        failedCount: 1,
        windowStart: now,
        lockUntil: null,
        lastFailedAt: now,
      });
      return;
    }

    this.storage.upsertLoginAttempt({
      ...existing,
      failedCount: existing.failedCount + 1,
      lastFailedAt: now,
      lockUntil: null,
    });
  }

  private recordAccountFailure(ip: string, username: string, now: number): void {
    const existing = this.storage.getLoginAttempt(ip, username);
    const failedCount = (existing?.failedCount ?? 0) + 1;

    let lockUntil: number | null = null;
    if (failedCount >= ACCOUNT_LOCK_THRESHOLD) {
      const level = failedCount - ACCOUNT_LOCK_THRESHOLD;
      const lockMs = Math.min(ACCOUNT_BASE_LOCK_MS * Math.pow(2, level), ACCOUNT_MAX_LOCK_MS);
      lockUntil = now + lockMs;
    }

    this.storage.upsertLoginAttempt({
      ip,
      username,
      failedCount,
      windowStart: existing?.windowStart ?? now,
      lockUntil,
      lastFailedAt: now,
    });
  }
}
