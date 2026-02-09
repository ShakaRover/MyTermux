/**
 * 连接状态管理 Store
 *
 * 管理与 daemon 的 WebSocket 连接状态和加密密钥
 */

import { create } from 'zustand';
import type { KeyPair } from '@mycc/shared';

/** 连接状态枚举 */
export type ConnectionState =
  | 'disconnected'   // 未连接
  | 'connecting'     // 正在连接中继服务器
  | 'connected'      // 已连接中继服务器，等待配对
  | 'pairing'        // 配对中
  | 'paired'         // 已配对，可以通信
  | 'error';         // 错误状态

/** 连接 Store 状态 */
export interface ConnectionStoreState {
  /** 当前连接状态 */
  state: ConnectionState;
  /** 错误信息 */
  error: string | null;
  /** 本地设备 ID */
  deviceId: string | null;
  /** 已配对的 daemon ID */
  daemonId: string | null;
  /** 本地密钥对 */
  keyPair: KeyPair | null;
  /** 共享密钥（用于 E2E 加密） */
  sharedKey: CryptoKey | null;
  /** WebSocket 实例 */
  ws: WebSocket | null;
  /** 中继服务器地址 */
  relayUrl: string;
}

/** 连接 Store 操作 */
export interface ConnectionStoreActions {
  /** 设置连接状态 */
  setState: (state: ConnectionState) => void;
  /** 设置错误信息 */
  setError: (error: string | null) => void;
  /** 设置设备 ID */
  setDeviceId: (deviceId: string) => void;
  /** 设置已配对的 daemon ID */
  setDaemonId: (daemonId: string | null) => void;
  /** 设置本地密钥对 */
  setKeyPair: (keyPair: KeyPair) => void;
  /** 设置共享密钥 */
  setSharedKey: (sharedKey: CryptoKey | null) => void;
  /** 设置 WebSocket 实例 */
  setWs: (ws: WebSocket | null) => void;
  /** 设置中继服务器地址 */
  setRelayUrl: (url: string) => void;
  /** 重置连接状态 */
  reset: () => void;
  /** 断开连接 */
  disconnect: () => void;
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
  relayUrl: import.meta.env.VITE_RELAY_URL || 'wss://relay.mycc.dev',
};

/** 连接状态 Store */
export const useConnectionStore = create<ConnectionStoreState & ConnectionStoreActions>(
  (set, get) => ({
    ...initialState,

    setState: (state) => set({ state }),

    setError: (error) => set({ error, state: error ? 'error' : get().state }),

    setDeviceId: (deviceId) => set({ deviceId }),

    setDaemonId: (daemonId) => set({ daemonId }),

    setKeyPair: (keyPair) => set({ keyPair }),

    setSharedKey: (sharedKey) => set({ sharedKey }),

    setWs: (ws) => set({ ws }),

    setRelayUrl: (relayUrl) => set({ relayUrl }),

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
  })
);
