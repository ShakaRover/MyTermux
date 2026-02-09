import { describe, it, expect } from 'vitest';
import {
  generateKeyPair,
  deriveSharedSecret,
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  generatePairingCode,
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from '../src/crypto';

describe('Crypto Module', () => {
  describe('generateKeyPair', () => {
    it('should generate a valid key pair', async () => {
      const keyPair = await generateKeyPair();

      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(typeof keyPair.publicKey).toBe('string');
      // P-256 公钥是 65 字节，Base64 编码后约 88 字符
      expect(keyPair.publicKey.length).toBeGreaterThan(80);
    });

    it('should generate unique key pairs', async () => {
      const keyPair1 = await generateKeyPair();
      const keyPair2 = await generateKeyPair();

      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
    });
  });

  describe('deriveSharedSecret', () => {
    it('should derive the same shared secret from both sides', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();

      // Alice 使用自己的私钥和 Bob 的公钥派生密钥
      const aliceSharedKey = await deriveSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );

      // Bob 使用自己的私钥和 Alice 的公钥派生密钥
      const bobSharedKey = await deriveSharedSecret(
        bobKeyPair.privateKey,
        aliceKeyPair.publicKey
      );

      // 两边应该能够相互加解密
      const message = 'Hello, World!';
      const encrypted = await encrypt(aliceSharedKey, message);
      const decrypted = await decrypt(bobSharedKey, encrypted);

      expect(decrypted).toBe(message);
    });
  });

  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt a message', async () => {
      const keyPair = await generateKeyPair();
      const sharedKey = await deriveSharedSecret(
        keyPair.privateKey,
        keyPair.publicKey
      );

      const message = '这是一条测试消息 🚀';
      const encrypted = await encrypt(sharedKey, message);

      expect(encrypted.iv).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.ciphertext).not.toBe(message);

      const decrypted = await decrypt(sharedKey, encrypted);
      expect(decrypted).toBe(message);
    });

    it('should produce different ciphertexts for the same message', async () => {
      const keyPair = await generateKeyPair();
      const sharedKey = await deriveSharedSecret(
        keyPair.privateKey,
        keyPair.publicKey
      );

      const message = 'Same message';
      const encrypted1 = await encrypt(sharedKey, message);
      const encrypted2 = await encrypt(sharedKey, message);

      // 由于随机 IV，密文应该不同
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    });

    it('should fail to decrypt with wrong key', async () => {
      const keyPair1 = await generateKeyPair();
      const keyPair2 = await generateKeyPair();

      const sharedKey1 = await deriveSharedSecret(
        keyPair1.privateKey,
        keyPair1.publicKey
      );
      const sharedKey2 = await deriveSharedSecret(
        keyPair2.privateKey,
        keyPair2.publicKey
      );

      const message = 'Secret message';
      const encrypted = await encrypt(sharedKey1, message);

      await expect(decrypt(sharedKey2, encrypted)).rejects.toThrow();
    });
  });

  describe('encryptJson and decryptJson', () => {
    it('should encrypt and decrypt JSON objects', async () => {
      const keyPair = await generateKeyPair();
      const sharedKey = await deriveSharedSecret(
        keyPair.privateKey,
        keyPair.publicKey
      );

      const data = {
        action: 'session:create',
        sessionType: 'claude',
        options: { cwd: '/home/user' },
      };

      const encrypted = await encryptJson(sharedKey, data);
      expect(typeof encrypted).toBe('string');

      const decrypted = await decryptJson(sharedKey, encrypted);
      expect(decrypted).toEqual(data);
    });
  });

  describe('generatePairingCode', () => {
    it('should generate a 6-digit code', () => {
      const code = generatePairingCode();

      expect(code).toMatch(/^\d{6}$/);
      expect(Number(code)).toBeGreaterThanOrEqual(100000);
      expect(Number(code)).toBeLessThanOrEqual(999999);
    });

    it('should generate different codes', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 10; i++) {
        codes.add(generatePairingCode());
      }
      // 10 次生成应该至少有多个不同的码
      expect(codes.size).toBeGreaterThan(1);
    });
  });

  describe('Base64 utilities', () => {
    it('should convert ArrayBuffer to Base64 and back', () => {
      const original = new Uint8Array([0, 1, 2, 255, 128, 64]);

      const base64 = arrayBufferToBase64(original);
      const restored = new Uint8Array(base64ToArrayBuffer(base64));

      expect(restored).toEqual(original);
    });

    it('should handle empty buffer', () => {
      const original = new Uint8Array([]);

      const base64 = arrayBufferToBase64(original);
      const restored = new Uint8Array(base64ToArrayBuffer(base64));

      expect(restored).toEqual(original);
    });
  });
});
