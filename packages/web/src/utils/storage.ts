/**
 * 持久化存储工具
 *
 * 使用 localStorage 保存配对令牌和连接信息
 *
 * 术语说明：代码中的 "pairing"（配对）是历史遗留命名，
 * 实际流程已改为 Access Token 认证。"pairing token" 指保存在本地的认证凭证，
 * 包含 deviceId、daemonId、密钥对和 accessToken 等信息。
 */

import type { KeyPair } from '@mycc/shared';

/** 存储键名 */
const PAIRING_TOKEN_KEY = 'mycc:pairing_token';

/** 配对令牌信息 */
export interface PairingToken {
  /** 本地设备 ID */
  deviceId: string;
  /** 已认证的 daemon ID */
  daemonId: string;
  /** 公钥 */
  publicKey: string;
  /** 私钥（JWK 格式） */
  privateKeyJwk: JsonWebKey;
  /** 认证时间戳 */
  pairedAt: number;
  /** 中继服务器地址 */
  relayUrl: string;
  /** Access Token（用于重连认证） */
  accessToken?: string;
}

/**
 * 保存配对令牌
 * @throws 当 localStorage 不可用或存储空间不足时抛出异常
 */
export function savePairingToken(token: PairingToken): void {
  localStorage.setItem(PAIRING_TOKEN_KEY, JSON.stringify(token));
}

/**
 * 获取配对令牌
 */
export function getPairingToken(): PairingToken | null {
  try {
    const data = localStorage.getItem(PAIRING_TOKEN_KEY);
    if (!data) {
      return null;
    }
    return JSON.parse(data) as PairingToken;
  } catch (error) {
    console.error('获取配对令牌失败:', error);
    return null;
  }
}

/**
 * 清除配对令牌
 * @returns 清除是否成功（localStorage 不可用时返回 false）
 */
export function clearPairingToken(): boolean {
  try {
    localStorage.removeItem(PAIRING_TOKEN_KEY);
    return true;
  } catch (error) {
    console.error('清除配对令牌失败:', error);
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
 * 从配对令牌恢复密钥对
 */
export async function restoreKeyPairFromToken(token: PairingToken): Promise<KeyPair> {
  const privateKey = await importPrivateKeyFromJwk(token.privateKeyJwk);
  return {
    publicKey: token.publicKey,
    privateKey,
  };
}
