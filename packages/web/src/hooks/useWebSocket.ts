/**
 * WebSocket 连接 Hook
 *
 * 连接模型：
 * - 必须先登录 Web
 * - 通过 /api/ws-ticket 获取一次性 ticket
 * - 使用 ticket 建立 /ws 连接并发送 token_auth
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  createTransportMessage,
  generateMessageId,
  isTransportMessage,
  type AppMessage,
  type DaemonProfile,
} from '@opentermux/shared';
import { requestWsTicket } from '../api';
import { useConnectionStore } from '../stores/connectionStore';
import { useEncryption } from './useEncryption';
import { useSessionsStore } from '../stores/sessionsStore';

const HEARTBEAT_INTERVAL_MS = 30_000;

export interface UseWebSocketReturn {
  connectWithProfile: (profile: DaemonProfile) => Promise<void>;
  disconnect: () => void;
  send: (message: AppMessage) => Promise<void>;
  isConnecting: boolean;
}

export function useWebSocket(): UseWebSocketReturn {
  const { state } = useConnectionStore();
  const { initKeyPair, deriveSharedKey, encrypt, decrypt } = useEncryption();

  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback((socket: WebSocket, deviceId: string) => {
    clearHeartbeat();

    heartbeatRef.current = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const heartbeat = createTransportMessage('heartbeat', deviceId, '');
      socket.send(JSON.stringify(heartbeat));
    }, HEARTBEAT_INTERVAL_MS);
  }, [clearHeartbeat]);

  const disconnect = useCallback(() => {
    const store = useConnectionStore.getState();
    clearHeartbeat();
    store.disconnect();
    useSessionsStore.getState().clearSessions();
  }, [clearHeartbeat]);

  const handleTransportMessage = useCallback(async (event: MessageEvent) => {
    const store = useConnectionStore.getState();

    let data: unknown;
    try {
      data = JSON.parse(event.data as string);
    } catch {
      store.setError('收到无效的 JSON 消息');
      return;
    }

    if (!isTransportMessage(data)) {
      store.setError('收到无效的传输层消息');
      return;
    }

    switch (data.type) {
      case 'token_ack': {
        let payload: {
          success: boolean;
          daemonId?: string;
          publicKey?: string;
          error?: string;
        };

        try {
          payload = JSON.parse(data.payload) as typeof payload;
        } catch {
          store.setState('error');
          store.setError('认证响应格式错误');
          return;
        }

        if (!payload.success || !payload.publicKey) {
          store.setState('error');
          store.setError(payload.error || 'Daemon 认证失败');
          const currentWs = useConnectionStore.getState().ws;
          currentWs?.close(4001, '认证失败');
          return;
        }

        try {
          await deriveSharedKey(payload.publicKey);
          store.setDaemonId(payload.daemonId ?? null);
          store.setState('authenticated');
          store.setError(null);
        } catch (error) {
          store.setState('error');
          store.setError(error instanceof Error ? error.message : '共享密钥建立失败');
        }
        break;
      }

      case 'message': {
        try {
          const appMessage = await decrypt<AppMessage>(data.payload);
          const globalHandler = useConnectionStore.getState().appMessageHandler;
          globalHandler?.(appMessage);
        } catch {
          store.setError('消息解密失败，请重新连接 daemon');
        }
        break;
      }

      case 'error': {
        try {
          const payload = JSON.parse(data.payload) as { message?: string };
          store.setError(payload.message || 'Relay 返回错误');
        } catch {
          store.setError('Relay 返回错误');
        }
        break;
      }

      case 'heartbeat':
      case 'register':
        break;

      default:
        break;
    }
  }, [decrypt, deriveSharedKey]);

  const connectWithProfile = useCallback(async (profile: DaemonProfile): Promise<void> => {
    if (!profile.hasToken) {
      throw new Error('该 daemon 配置未设置 Access Token');
    }

    // 单活 daemon 模式：切换前关闭旧连接并清空会话
    disconnect();

    const store = useConnectionStore.getState();
    store.setState('connecting');
    store.setError(null);
    store.setActiveProfile(profile);

    try {
      // 1) 先申请一次性 ws-ticket
      const wsTicket = await requestWsTicket(profile.id);

      // 2) 生成本地密钥对与 deviceId
      const keyPair = await initKeyPair();
      const deviceId = `client-${generateMessageId()}`;

      store.setDeviceId(deviceId);

      // 3) 建立 ws 连接（ticket 作为 query 参数）
      const wsUrl = buildWsUrl(store.relayUrl, wsTicket.ticket);
      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        const payload = JSON.stringify({
          deviceType: 'client',
          publicKey: keyPair.publicKey,
        });
        const tokenAuth = createTransportMessage('token_auth', deviceId, payload);

        socket.send(JSON.stringify(tokenAuth));
        useConnectionStore.getState().setState('authenticating');
        startHeartbeat(socket, deviceId);
      };

      socket.onmessage = (event) => {
        void handleTransportMessage(event);
      };

      socket.onerror = () => {
        const current = useConnectionStore.getState();
        current.setState('error');
        current.setError('WebSocket 连接错误');
      };

      socket.onclose = () => {
        const current = useConnectionStore.getState();
        if (current.ws !== socket) {
          return;
        }

        clearHeartbeat();
        current.setWs(null);
        current.setState('disconnected');
        current.setDaemonId(null);
        current.setSharedKey(null);
        current.setKeyPair(null);
        current.setDeviceId(null);
        useSessionsStore.getState().clearSessions();
      };

      store.setWs(socket);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '连接 daemon 失败';
      store.setState('error');
      store.setError(errorMessage);
      throw error;
    }
  }, [clearHeartbeat, disconnect, handleTransportMessage, initKeyPair, startHeartbeat]);

  const send = useCallback(async (message: AppMessage): Promise<void> => {
    const store = useConnectionStore.getState();

    if (!store.ws || store.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接');
    }

    if (!store.deviceId || !store.daemonId) {
      throw new Error('当前未认证到 daemon');
    }

    const encryptedPayload = await encrypt(message);
    const transport = createTransportMessage('message', store.deviceId, encryptedPayload, store.daemonId);
    store.ws.send(JSON.stringify(transport));
  }, [encrypt]);

  useEffect(() => {
    return () => {
      clearHeartbeat();
    };
  }, [clearHeartbeat]);

  return {
    connectWithProfile,
    disconnect,
    send,
    isConnecting: state === 'connecting' || state === 'authenticating',
  };
}

export function buildWsUrl(relayUrl: string, ticket: string): string {
  const withTicket = (base: string): string => {
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}ticket=${encodeURIComponent(ticket)}`;
  };

  if (relayUrl.startsWith('ws://') || relayUrl.startsWith('wss://')) {
    return withTicket(relayUrl);
  }

  if (typeof window === 'undefined') {
    return withTicket(`ws://localhost:3000/ws`);
  }

  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';

  if (relayUrl.startsWith('/')) {
    return withTicket(`${scheme}://${window.location.host}${relayUrl}`);
  }

  return withTicket(`${scheme}://${window.location.host}/${relayUrl.replace(/^\/+/, '')}`);
}
