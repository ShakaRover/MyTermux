/**
 * 连接状态管理 Store
 *
 * 管理与 daemon 的 WebSocket 连接状态和加密密钥
 *
 * 术语说明：代码中的 "pairing"（配对）是历史遗留命名，
 * 实际流程已改为 Access Token 认证模式。"paired" 状态表示认证完成。
 */

import { create } from 'zustand';
import type { KeyPair, AppMessage } from '@mycc/shared';
import {
  savePairingToken,
  getPairingToken,
  clearPairingToken,
  restoreKeyPairFromToken,
  exportPrivateKeyToJwk,
  type PairingToken,
} from '../utils/storage';

/** 连接状态枚举 */
export type ConnectionState =
  | 'disconnected'   // 未连接
  | 'connecting'     // 正在连接中继服务器
  | 'connected'      // 已连接中继服务器，等待认证
  | 'pairing'        // 认证中（历史命名，实际为 Token 认证流程）
  | 'paired'         // 已认证，可以通信
  | 'error';         // 错误状态

/** 应用消息处理器类型 */
export type AppMessageHandler = (message: AppMessage) => void;

/** 连接 Store 状态 */
export interface ConnectionStoreState {
  /** 当前连接状态 */
  state: ConnectionState;
  /** 错误信息 */
  error: string | null;
  /** 本地设备 ID */
  deviceId: string | null;
  /** 已认证的 daemon ID */
  daemonId: string | null;
  /** 本地密钥对 */
  keyPair: KeyPair | null;
  /** 共享密钥（用于 E2E 加密） */
  sharedKey: CryptoKey | null;
  /** WebSocket 实例 */
  ws: WebSocket | null;
  /** 中继服务器地址 */
  relayUrl: string;
  /** Access Token（用于重连认证） */
  accessToken: string | null;
  /** 全局应用消息处理器 */
  appMessageHandler: AppMessageHandler | null;
  /** 是否有保存的配对令牌（缓存值，避免每次渲染读取 localStorage） */
  _hasSavedPairing: boolean;
}

/** 连接 Store 操作 */
export interface ConnectionStoreActions {
  /** 设置连接状态 */
  setState: (state: ConnectionState) => void;
  /** 设置错误信息 */
  setError: (error: string | null) => void;
  /** 设置设备 ID */
  setDeviceId: (deviceId: string) => void;
  /** 设置已认证的 daemon ID */
  setDaemonId: (daemonId: string | null) => void;
  /** 设置本地密钥对 */
  setKeyPair: (keyPair: KeyPair) => void;
  /** 设置共享密钥 */
  setSharedKey: (sharedKey: CryptoKey | null) => void;
  /** 设置 WebSocket 实例 */
  setWs: (ws: WebSocket | null) => void;
  /** 设置中继服务器地址 */
  setRelayUrl: (url: string) => void;
  /** 设置 Access Token */
  setAccessToken: (token: string | null) => void;
  /** 重置连接状态 */
  reset: () => void;
  /** 断开连接 */
  disconnect: () => void;
  /** 保存配对令牌到本地存储（返回是否成功） */
  savePairingToStorage: () => Promise<boolean>;
  /** 从本地存储恢复配对信息 */
  restoreFromStorage: () => Promise<boolean>;
  /** 清除本地存储的配对信息 */
  clearStorage: () => void;
  /** 检查是否有保存的配对令牌 */
  hasSavedPairing: () => boolean;
  /** 设置全局应用消息处理器 */
  setAppMessageHandler: (handler: AppMessageHandler | null) => void;
}

/** 初始状态 */
const initialState: ConnectionStoreState = {
  state: 'disconnected',
  error: null,
  deviceId: null,
  daemonId: null,
  keyPair: null,
  sharedKey: null,
  ws: null,
  relayUrl: import.meta.env.VITE_RELAY_URL || 'ws://localhost:3000/ws',
  accessToken: null,
  appMessageHandler: null,
  /** C1: 缓存 hasSavedPairing 状态，避免每次渲染读取 localStorage */
  _hasSavedPairing: getPairingToken() !== null,
};

/** 连接状态 Store */
export const useConnectionStore = create<ConnectionStoreState & ConnectionStoreActions>(
  (set, get) => ({
    ...initialState,

    setState: (state) => set({ state }),

    setError: (error) => set({ error }),

    setDeviceId: (deviceId) => set({ deviceId }),

    setDaemonId: (daemonId) => set({ daemonId }),

    setKeyPair: (keyPair) => set({ keyPair }),

    setSharedKey: (sharedKey) => set({ sharedKey }),

    setWs: (ws) => set({ ws }),

    setRelayUrl: (relayUrl) => set({ relayUrl }),

    setAccessToken: (accessToken) => set({ accessToken }),

    reset: () => {
      const { ws } = get();
      if (ws) {
        ws.close();
      }
      set(initialState);
    },

    disconnect: () => {
      const { ws } = get();
      if (ws) {
        ws.close();
      }
      set({
        state: 'disconnected',
        ws: null,
        sharedKey: null,
        daemonId: null,
      });
    },

    savePairingToStorage: async () => {
      const { deviceId, daemonId, keyPair, relayUrl, accessToken } = get();
      if (!deviceId || !daemonId || !keyPair) {
        console.warn('无法保存配对令牌：缺少必要信息');
        return false;
      }

      try {
        const privateKeyJwk = await exportPrivateKeyToJwk(keyPair.privateKey);
        const token: PairingToken = {
          deviceId,
          daemonId,
          publicKey: keyPair.publicKey,
          privateKeyJwk,
          pairedAt: Date.now(),
          relayUrl,
          ...(accessToken && { accessToken }),
        };
        savePairingToken(token);
        set({ _hasSavedPairing: true });
        console.log('配对令牌已保存');
        return true;
      } catch (error) {
        console.error('保存配对令牌失败:', error);
        set({ error: '保存认证信息失败，重连时可能需要重新认证' });
        return false;
      }
    },

    restoreFromStorage: async () => {
      const token = getPairingToken();
      if (!token) {
        return false;
      }

      try {
        const keyPair = await restoreKeyPairFromToken(token);
        set({
          deviceId: token.deviceId,
          daemonId: token.daemonId,
          keyPair,
          relayUrl: token.relayUrl,
          accessToken: token.accessToken ?? null,
        });
        console.log('已从本地存储恢复配对信息');
        return true;
      } catch (error) {
        // C4: 恢复失败时设置错误信息，让用户知晓凭证已被清除
        console.error('恢复配对信息失败:', error);
        clearPairingToken();
        set({
          _hasSavedPairing: false,
          error: '本地认证信息已损坏，已清除，请重新输入 Access Token',
        });
        return false;
      }
    },

    clearStorage: () => {
      clearPairingToken();
      set({ _hasSavedPairing: false });
      console.log('已清除本地存储的配对信息');
    },

    hasSavedPairing: () => {
      return get()._hasSavedPairing;
    },

    setAppMessageHandler: (handler) => set({ appMessageHandler: handler }),
  })
);
