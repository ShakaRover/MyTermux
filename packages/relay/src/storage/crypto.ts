import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** 加密前缀版本 */
const TOKEN_CIPHER_VERSION = 'v1';

/** token 掩码展示 */
export function maskAccessToken(token: string): string {
  const dashIndex = token.indexOf('-');
  if (dashIndex === -1) {
    return token.length <= 8 ? token : `${token.slice(0, 4)}...${token.slice(-4)}`;
  }
  const prefix = token.slice(0, dashIndex + 1);
  const body = token.slice(dashIndex + 1);
  if (body.length <= 8) {
    return token;
  }
  return `${prefix}${body.slice(0, 4)}...${body.slice(-4)}`;
}

/** 从环境变量解析/派生 AES-256 密钥 */
export function deriveAesKey(masterKey: string): Buffer {
  const trimmed = masterKey.trim();

  // 64 位 hex（32 bytes）
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  // Base64 编码（32 bytes）
  try {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // ignore
  }

  // 其他格式统一哈希派生
  return createHash('sha256').update(trimmed).digest();
}

/** 加密 token */
export function encryptToken(token: string, aesKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${TOKEN_CIPHER_VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** 解密 token */
export function decryptToken(encrypted: string, aesKey: Buffer): string {
  const parts = encrypted.split(':');
  if (parts.length !== 4 || parts[0] !== TOKEN_CIPHER_VERSION) {
    throw new Error('无效的 token 密文格式');
  }

  const iv = Buffer.from(parts[1] ?? '', 'base64');
  const tag = Buffer.from(parts[2] ?? '', 'base64');
  const ciphertext = Buffer.from(parts[3] ?? '', 'base64');

  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

