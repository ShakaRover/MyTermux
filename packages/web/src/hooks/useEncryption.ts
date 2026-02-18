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
} from '@mytermux/shared';
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
  const { setKeyPair, setSharedKey } = useConnectionStore();

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
   * 使用 getState() 获取最新的 keyPair，避免闭包问题
   */
  const deriveSharedKey = useCallback(
    async (peerPublicKey: string): Promise<void> => {
      // 从 store 获取最新状态，避免闭包问题
      const currentKeyPair = useConnectionStore.getState().keyPair;
      if (!currentKeyPair) {
        throw new Error('密钥对未初始化');
      }
      const shared = await deriveSharedSecret(currentKeyPair.privateKey, peerPublicKey);
      setSharedKey(shared);
    },
    [setSharedKey]
  );

  /**
   * 加密消息
   * 使用 getState() 获取最新的 sharedKey，避免闭包问题
   */
  const encrypt = useCallback(
    async <T>(data: T): Promise<string> => {
      // 从 store 获取最新状态，避免闭包问题
      const currentSharedKey = useConnectionStore.getState().sharedKey;
      if (!currentSharedKey) {
        throw new Error('共享密钥未建立');
      }
      return encryptJson(currentSharedKey, data);
    },
    []
  );

  /**
   * 解密消息
   * 使用 getState() 获取最新的 sharedKey，避免闭包问题
   */
  const decrypt = useCallback(
    async <T>(encryptedData: string): Promise<T> => {
      // 从 store 获取最新状态，避免闭包问题
      const currentSharedKey = useConnectionStore.getState().sharedKey;
      if (!currentSharedKey) {
        throw new Error('共享密钥未建立');
      }
      return decryptJson<T>(currentSharedKey, encryptedData);
    },
    []
  );

  return {
    isInitialized,
    initKeyPair,
    deriveSharedKey,
    encrypt,
    decrypt,
  };
}
