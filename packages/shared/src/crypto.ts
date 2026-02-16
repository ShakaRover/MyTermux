/**
 * E2E 加密模块
 *
 * 使用 ECDH P-256 进行密钥交换
 * 使用 AES-256-GCM 进行消息加密
 */

// ============================================================================
// 类型定义
// ============================================================================

/** 密钥对 */
export interface KeyPair {
  /** 公钥（Base64 编码） */
  publicKey: string;
  /** 私钥（CryptoKey 对象，仅在本地使用） */
  privateKey: CryptoKey;
}

/** 加密后的消息结构 */
export interface EncryptedMessage {
  /** 初始化向量（Base64 编码） */
  iv: string;
  /** 密文（Base64 编码） */
  ciphertext: string;
}

// ============================================================================
// 密钥生成与交换
// ============================================================================

/**
 * 生成 ECDH 密钥对
 * @returns 密钥对，包含 Base64 编码的公钥和 CryptoKey 私钥
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true, // 可导出
    ['deriveKey', 'deriveBits']
  );

  // 导出公钥为 Base64
  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const publicKeyBase64 = arrayBufferToBase64(publicKeyRaw);

  return {
    publicKey: publicKeyBase64,
    privateKey: keyPair.privateKey,
  };
}

/**
 * 从 Base64 编码的公钥导入 CryptoKey
 * @param publicKeyBase64 Base64 编码的公钥
 * @returns CryptoKey 公钥对象
 */
export async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  const publicKeyRaw = base64ToArrayBuffer(publicKeyBase64);
  return crypto.subtle.importKey(
    'raw',
    publicKeyRaw,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    []
  );
}

/**
 * 使用 ECDH 派生共享密钥
 * @param privateKey 本地私钥
 * @param peerPublicKeyBase64 对方公钥（Base64 编码）
 * @returns AES-GCM 密钥
 */
export async function deriveSharedSecret(
  privateKey: CryptoKey,
  peerPublicKeyBase64: string
): Promise<CryptoKey> {
  const peerPublicKey = await importPublicKey(peerPublicKeyBase64);

  return crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: peerPublicKey,
    },
    privateKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false, // 不可导出
    ['encrypt', 'decrypt']
  );
}

// ============================================================================
// 加密与解密
// ============================================================================

/**
 * 使用 AES-256-GCM 加密消息
 * @param sharedKey 共享密钥
 * @param plaintext 明文
 * @returns 加密后的消息结构
 */
export async function encrypt(
  sharedKey: CryptoKey,
  plaintext: string
): Promise<EncryptedMessage> {
  // 生成随机 IV（12 字节）
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // 编码明文
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);

  // 加密
  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    sharedKey,
    plaintextBytes
  );

  return {
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
  };
}

/**
 * 使用 AES-256-GCM 解密消息
 * @param sharedKey 共享密钥
 * @param encryptedMessage 加密的消息结构
 * @returns 解密后的明文
 */
export async function decrypt(
  sharedKey: CryptoKey,
  encryptedMessage: EncryptedMessage
): Promise<string> {
  const iv = base64ToArrayBuffer(encryptedMessage.iv);
  const ciphertext = base64ToArrayBuffer(encryptedMessage.ciphertext);

  const plaintextBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(iv),
    },
    sharedKey,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(plaintextBuffer);
}

// ============================================================================
// 便捷方法
// ============================================================================

/**
 * 加密 JSON 对象
 * @param sharedKey 共享密钥
 * @param data 要加密的对象
 * @returns 加密后的消息字符串（JSON 格式）
 */
export async function encryptJson<T>(
  sharedKey: CryptoKey,
  data: T
): Promise<string> {
  const plaintext = JSON.stringify(data);
  const encrypted = await encrypt(sharedKey, plaintext);
  return JSON.stringify(encrypted);
}

/**
 * 解密 JSON 对象
 * @param sharedKey 共享密钥
 * @param encryptedString 加密的消息字符串
 * @returns 解密后的对象
 */
export async function decryptJson<T>(
  sharedKey: CryptoKey,
  encryptedString: string
): Promise<T> {
  const encrypted = JSON.parse(encryptedString) as EncryptedMessage;
  const plaintext = await decrypt(sharedKey, encrypted);
  return JSON.parse(plaintext) as T;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * ArrayBuffer 转 Base64
 */
export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Base64 转 ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * 生成 Access Token（用于 daemon 授权客户端连接）
 * 格式：opentermux-<32 个十六进制字符>（128 位随机熵，总长度 37 字符）
 */
export function generateAccessToken(): string {
  const array = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `opentermux-${hex}`;
}
