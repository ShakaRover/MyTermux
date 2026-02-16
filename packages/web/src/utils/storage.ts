/**
 * 持久化存储工具
 *
 * 使用 localStorage 保存认证凭证和连接信息
 */

import type { KeyPair } from '@opentermux/shared';

/** 存储键名 */
const AUTH_TOKEN_KEY = 'opentermux:auth_token';

/** 认证凭证信息 */
export interface AuthToken {
  /** 本地设备 ID */
  deviceId: string;
  /** 已认证的 daemon ID */
  daemonId: string;
  /** 公钥 */
  publicKey: string;
  /** 私钥（JWK 格式） */
  privateKeyJwk: JsonWebKey;
  /** 认证时间戳 */
  authenticatedAt: number;
  /** 中继服务器地址 */
  relayUrl: string;
  /** Access Token（用于重连认证） */
  accessToken?: string;
}

/**
 * 保存认证凭证
 * @throws 当 localStorage 不可用或存储空间不足时抛出异常
 */
export function saveAuthToken(token: AuthToken): void {
  localStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify(token));
}

/**
 * 获取认证凭证
 */
export function getAuthToken(): AuthToken | null {
  try {
    const data = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!data) {
      return null;
    }
    return JSON.parse(data) as AuthToken;
  } catch (error) {
    console.error('获取认证凭证失败:', error);
    return null;
  }
}

/**
 * 清除认证凭证
 * @returns 清除是否成功（localStorage 不可用时返回 false）
 */
export function clearAuthToken(): boolean {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    return true;
  } catch (error) {
    console.error('清除认证凭证失败:', error);
    return false;
  }
}

/**
 * 从 JWK 导入私钥
 */
export async function importPrivateKeyFromJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveKey', 'deriveBits']
  );
}

/**
 * 将私钥导出为 JWK 格式
 */
export async function exportPrivateKeyToJwk(privateKey: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', privateKey);
}

/**
 * 从认证凭证恢复密钥对
 */
export async function restoreKeyPairFromAuthToken(token: AuthToken): Promise<KeyPair> {
  const privateKey = await importPrivateKeyFromJwk(token.privateKeyJwk);
  return {
    publicKey: token.publicKey,
    privateKey,
  };
}
