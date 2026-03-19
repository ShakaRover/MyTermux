/**
 * Daemon 连接状态 Store
 *
 * 管理 WebSocket、E2E 密钥与当前活跃 daemon profile。
 */

import { create } from 'zustand';
import type { AppMessage, DaemonProfile, KeyPair } from '@mytermux/shared';

/** 连接状态枚举 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'authenticated'
  | 'error';

/** 应用消息处理器类型 */
export type AppMessageHandler = (message: AppMessage) => void;

/** 连接 Store 状态 */
export interface ConnectionStoreState {
  state: ConnectionState;
  error: string | null;
  deviceId: string | null;
  daemonId: string | null;
  keyPair: KeyPair | null;
  sharedKey: CryptoKey | null;
  ws: WebSocket | null;
  relayUrl: string;
  webLinkToken: string | null;
  activeProfile: DaemonProfile | null;
  appMessageHandler: AppMessageHandler | null;
}

/** 连接 Store 操作 */
export interface ConnectionStoreActions {
  setState: (state: ConnectionState) => void;
  setError: (error: string | null) => void;
  setDeviceId: (deviceId: string | null) => void;
  setDaemonId: (daemonId: string | null) => void;
  setKeyPair: (keyPair: KeyPair | null) => void;
  setSharedKey: (sharedKey: CryptoKey | null) => void;
  setWs: (ws: WebSocket | null) => void;
  setRelayUrl: (url: string) => void;
  setWebLinkToken: (token: string | null) => void;
  setActiveProfile: (profile: DaemonProfile | null) => void;
  setAppMessageHandler: (handler: AppMessageHandler | null) => void;
  disconnect: () => void;
  reset: () => void;
}

function getDefaultRelayUrl(): string {
  if (typeof window === 'undefined') {
    return 'ws://127.0.0.1:62200/ws';
  }

  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/ws`;
}

function getDefaultWebLinkToken(): string | null {
  const fromEnv = import.meta.env.VITE_MYTERMUX_WEB_LINK_TOKEN?.trim();
  return fromEnv || null;
}

const initialState: ConnectionStoreState = {
  state: 'disconnected',
  error: null,
  deviceId: null,
  daemonId: null,
  keyPair: null,
  sharedKey: null,
  ws: null,
  relayUrl: import.meta.env.VITE_SERVER_URL || import.meta.env.VITE_RELAY_URL || getDefaultRelayUrl(),
  webLinkToken: getDefaultWebLinkToken(),
  activeProfile: null,
  appMessageHandler: null,
};

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
    setWebLinkToken: (webLinkToken) => set({ webLinkToken }),
    setActiveProfile: (activeProfile) => set({ activeProfile }),
    setAppMessageHandler: (appMessageHandler) => set({ appMessageHandler }),

    disconnect: () => {
      const { ws } = get();
      if (ws) {
        ws.close();
      }

      set({
        ws: null,
        state: 'disconnected',
        daemonId: null,
        sharedKey: null,
        keyPair: null,
        deviceId: null,
      });
    },

    reset: () => {
      const { ws } = get();
      if (ws) {
        ws.close();
      }

      set(initialState);
    },
  }),
);
