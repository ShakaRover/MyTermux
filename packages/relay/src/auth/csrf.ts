import { randomBytes } from 'node:crypto';

/** 生成 CSRF Token */
export function generateCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}
