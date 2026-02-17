import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** scrypt hash 解析结果 */
interface ParsedScryptHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/** 默认 scrypt 参数 */
const DEFAULT_SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 64,
} as const;

/** scrypt hash 前缀 */
const SCRYPT_PREFIX = 'scrypt';

/** 生成 scrypt 存储串：scrypt$N$r$p$saltB64$hashB64 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, DEFAULT_SCRYPT_PARAMS.keyLength, {
    N: DEFAULT_SCRYPT_PARAMS.N,
    r: DEFAULT_SCRYPT_PARAMS.r,
    p: DEFAULT_SCRYPT_PARAMS.p,
  });

  return [
    SCRYPT_PREFIX,
    String(DEFAULT_SCRYPT_PARAMS.N),
    String(DEFAULT_SCRYPT_PARAMS.r),
    String(DEFAULT_SCRYPT_PARAMS.p),
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/** 校验 hash 串格式是否可解析 */
export function isScryptHash(hashString: string): boolean {
  try {
    parseScryptHash(hashString);
    return true;
  } catch {
    return false;
  }
}

/** 验证明文密码是否匹配 scrypt hash */
export function verifyPassword(password: string, hashString: string): boolean {
  const parsed = parseScryptHash(hashString);
  const derived = scryptSync(password, parsed.salt, parsed.hash.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
  });

  if (derived.length !== parsed.hash.length) {
    return false;
  }

  return timingSafeEqual(derived, parsed.hash);
}

/** 解析 scrypt hash */
function parseScryptHash(hashString: string): ParsedScryptHash {
  const parts = hashString.split('$');
  if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) {
    throw new Error('无效的密码哈希格式');
  }

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);

  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    throw new Error('无效的 scrypt 参数');
  }

  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const hash = Buffer.from(parts[5] ?? '', 'base64');

  if (salt.length === 0 || hash.length === 0) {
    throw new Error('无效的盐值或哈希数据');
  }

  return { N, r, p, salt, hash };
}
