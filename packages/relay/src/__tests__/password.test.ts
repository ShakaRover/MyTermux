import { describe, expect, it } from 'vitest';
import { hashPassword, isScryptHash, verifyPassword } from '../auth/password';

describe('password utils', () => {
  it('should generate valid scrypt hash format', () => {
    const hash = hashPassword('opentermux');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(isScryptHash(hash)).toBe(true);
  });

  it('should verify correct password', () => {
    const hash = hashPassword('strong-pass');
    expect(verifyPassword('strong-pass', hash)).toBe(true);
    expect(verifyPassword('wrong-pass', hash)).toBe(false);
  });

  it('should reject invalid hash formats', () => {
    expect(isScryptHash('')).toBe(false);
    expect(isScryptHash('bcrypt$abc')).toBe(false);
    expect(() => verifyPassword('x', 'bad-format')).toThrow();
  });
});
