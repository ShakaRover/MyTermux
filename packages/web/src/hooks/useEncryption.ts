/**
 * 加密通信 Hook
 *
 * 提供 E2E 加密功能的封装
 */

import { useCallback, useState } from 'react';
import {
  generateKeyPair,
  deriveSharedSecret,
  encryptJson,
  decryptJson,
  type KeyPair,
} from '@mycc/shared';
import { useConnectionStore } from '../stores/connectionStore';

/** 加密 Hook 返回值 */
export interface UseEncryptionReturn {
  /** 是否已初始化密钥对 */
  isInitialized: boolean;
  /** 生成密钥对 */
  initKeyPair: () => Promise<KeyPair>;
  /** 派生共享密钥 */
  deriveSharedKey: (peerPublicKey: string) => Promise<void>;
  /** 加密消息 */
  encrypt: <T>(data: T) => Promise<string>;
  /** 解密消息 */
  decrypt: <T>(encryptedData: string) => Promise<T>;
}

/**
 * 加密通信 Hook
 *
 * 管理密钥对生成、共享密钥派生和消息加解密
 */
export function useEncryption(): UseEncryptionReturn {
  const [isInitialized, setIsInitialized] = useState(false);
  const { keyPair, sharedKey, setKeyPair, setSharedKey } = useConnectionStore();

  /**
   * 初始化密钥对
   */
  const initKeyPair = useCallback(async (): Promise<KeyPair> => {
    const newKeyPair = await generateKeyPair();
    setKeyPair(newKeyPair);
    setIsInitialized(true);
    return newKeyPair;
  }, [setKeyPair]);

  /**
   * 派生共享密钥
   */
  const deriveSharedKey = useCallback(
    async (peerPublicKey: string): Promise<void> => {
      if (!keyPair) {
        throw new Error('密钥对未初始化');
      }
      const shared = await deriveSharedSecret(keyPair.privateKey, peerPublicKey);
      setSharedKey(shared);
    },
    [keyPair, setSharedKey]
  );

  /**
   * 加密消息
   */
  const encrypt = useCallback(
    async <T>(data: T): Promise<string> => {
      if (!sharedKey) {
        throw new Error('共享密钥未建立');
      }
      return encryptJson(sharedKey, data);
    },
    [sharedKey]
  );

  /**
   * 解密消息
   */
  const decrypt = useCallback(
    async <T>(encryptedData: string): Promise<T> => {
      if (!sharedKey) {
        throw new Error('共享密钥未建立');
      }
      return decryptJson<T>(sharedKey, encryptedData);
    },
    [sharedKey]
  );

  return {
    isInitialized,
    initKeyPair,
    deriveSharedKey,
    encrypt,
    decrypt,
  };
}
