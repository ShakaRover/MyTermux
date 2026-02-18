import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LoginBruteforceGuard } from '../auth/bruteforce';
import { RelayStorage } from '../storage';

describe('LoginBruteforceGuard', () => {
  let guard: LoginBruteforceGuard;
  let storage: RelayStorage;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mytermux-relay-test-'));
    const dbPath = path.join(tempDir, 'relay.db');
    storage = new RelayStorage(dbPath, 'test-master-key');
    guard = new LoginBruteforceGuard(storage);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should lock account+ip after 5 failures and exponentially backoff', () => {
    const ip = '127.0.0.1';
    const username = 'admin';
    const base = 1_700_000_000_000;

    for (let i = 0; i < 5; i++) {
      guard.recordFailure(ip, username, base + i * 1_000);
    }

    const firstLock = guard.check(ip, username, base + 5_500);
    expect(firstLock.allowed).toBe(false);
    expect(firstLock.reason).toBe('account_locked');
    expect(firstLock.retryAfterSeconds).toBeGreaterThanOrEqual(290);

    // 第 6 次失败后，锁定时间翻倍到 10 分钟
    const lockExpiredAt = base + 5 * 1_000 + 5 * 60 * 1_000;
    guard.recordFailure(ip, username, lockExpiredAt + 1);
    const secondLock = guard.check(ip, username, lockExpiredAt + 2);
    expect(secondLock.allowed).toBe(false);
    expect(secondLock.reason).toBe('account_locked');
    expect(secondLock.retryAfterSeconds).toBeGreaterThanOrEqual(590);
  });

  it('should rate limit by ip within 10-minute window', () => {
    const ip = '10.0.0.1';
    const base = 1_700_100_000_000;

    for (let i = 0; i < 30; i++) {
      guard.recordFailure(ip, `user-${i}`, base + i);
    }

    const result = guard.check(ip, 'any-user', base + 1000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('ip_rate_limited');
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('should clear counters on successful login', () => {
    const ip = '192.168.1.100';
    const username = 'admin';
    const now = Date.now();

    guard.recordFailure(ip, username, now);
    expect(guard.check(ip, username, now + 1).allowed).toBe(true);

    guard.recordSuccess(ip, username);
    expect(guard.check(ip, username, now + 2).allowed).toBe(true);
  });
});
