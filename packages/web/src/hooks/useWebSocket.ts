/**
 * WebSocket 连接 Hook
 *
 * 管理与中继服务器的 WebSocket 连接，处理配对和消息路由
 */

import { useCallback, useRef, useEffect } from 'react';
import {
  createTransportMessage,
  generateMessageId,
  isTransportMessage,
  type TransportMessage,
  type AppMessage,
} from '@mycc/shared';
import { useConnectionStore } from '../stores/connectionStore';
import { useEncryption } from './useEncryption';

/** WebSocket Hook 配置 */
export interface UseWebSocketOptions {
  /** 收到应用层消息时的回调 */
  onAppMessage?: (message: AppMessage) => void;
  /** 连接建立时的回调 */
  onConnected?: () => void;
  /** 连接断开时的回调 */
  onDisconnected?: () => void;
  /** 配对成功时的回调 */
  onPaired?: (daemonId: string) => void;
  /** 发生错误时的回调 */
  onError?: (error: string) => void;
}

/** WebSocket Hook 返回值 */
export interface UseWebSocketReturn {
  /** 连接到中继服务器 */
  connect: () => Promise<void>;
  /** 断开连接 */
  disconnect: () => void;
  /** 发起配对 */
  pair: (code: string) => Promise<void>;
  /** 发送应用层消息 */
  send: (message: AppMessage) => Promise<void>;
  /** 是否正在连接 */
  isConnecting: boolean;
}

/**
 * WebSocket 连接 Hook
 *
 * 处理 WebSocket 连接生命周期、配对流程和加密通信
 */
export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const { onAppMessage, onConnected, onDisconnected, onPaired, onError } = options;

  const {
    state,
    relayUrl,
    deviceId,
    daemonId,
    ws,
    setState,
    setWs,
    setDeviceId,
    setDaemonId,
    setError,
  } = useConnectionStore();

  const { initKeyPair, deriveSharedKey, encrypt, decrypt } = useEncryption();

  // 使用 ref 存储回调，避免闭包问题
  const callbacksRef = useRef({ onAppMessage, onConnected, onDisconnected, onPaired, onError });
  callbacksRef.current = { onAppMessage, onConnected, onDisconnected, onPaired, onError };

  // 心跳定时器
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * 处理收到的消息
   */
  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        if (!isTransportMessage(data)) {
          console.warn('收到无效的传输层消息:', data);
          return;
        }

        const message = data as TransportMessage;

        switch (message.type) {
          case 'pair_ack': {
            // 配对确认
            const payload = JSON.parse(message.payload) as {
              success: boolean;
              daemonId?: string;
              publicKey?: string;
              error?: string;
            };

            if (payload.success && payload.daemonId && payload.publicKey) {
              // 派生共享密钥
              await deriveSharedKey(payload.publicKey);
              setDaemonId(payload.daemonId);
              setState('paired');
              callbacksRef.current.onPaired?.(payload.daemonId);
            } else {
              setError(payload.error || '配对失败');
              callbacksRef.current.onError?.(payload.error || '配对失败');
            }
            break;
          }

          case 'message': {
            // 加密的应用层消息
            if (message.payload) {
              try {
                const appMessage = await decrypt<AppMessage>(message.payload);
                callbacksRef.current.onAppMessage?.(appMessage);
              } catch (err) {
                console.error('解密消息失败:', err);
              }
            }
            break;
          }

          case 'error': {
            const payload = JSON.parse(message.payload) as { code: string; message: string };
            setError(payload.message);
            callbacksRef.current.onError?.(payload.message);
            break;
          }

          case 'heartbeat': {
            // 心跳响应，忽略
            break;
          }

          default:
            console.warn('未知消息类型:', message.type);
        }
      } catch (err) {
        console.error('处理消息失败:', err);
      }
    },
    [deriveSharedKey, decrypt, setDaemonId, setError, setState]
  );

  /**
   * 连接到中继服务器
   */
  const connect = useCallback(async (): Promise<void> => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      return;
    }

    setState('connecting');

    try {
      // 生成密钥对
      const keyPair = await initKeyPair();

      // 生成设备 ID
      const newDeviceId = `client-${generateMessageId()}`;
      setDeviceId(newDeviceId);

      // 创建 WebSocket 连接
      const socket = new WebSocket(relayUrl);

      socket.onopen = () => {
        // 发送注册消息
        const registerPayload = JSON.stringify({
          deviceType: 'client',
          publicKey: keyPair.publicKey,
        });
        const registerMessage = createTransportMessage('register', newDeviceId, registerPayload);
        socket.send(JSON.stringify(registerMessage));

        setState('connected');
        callbacksRef.current.onConnected?.();

        // 启动心跳
        heartbeatRef.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            const heartbeat = createTransportMessage('heartbeat', newDeviceId, '');
            socket.send(JSON.stringify(heartbeat));
          }
        }, 30000);
      };

      socket.onmessage = handleMessage;

      socket.onclose = () => {
        setState('disconnected');
        setWs(null);
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
        callbacksRef.current.onDisconnected?.();
      };

      socket.onerror = () => {
        setError('WebSocket 连接错误');
        callbacksRef.current.onError?.('WebSocket 连接错误');
      };

      setWs(socket);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '连接失败';
      setError(errorMessage);
      setState('error');
      callbacksRef.current.onError?.(errorMessage);
    }
  }, [ws, setState, initKeyPair, setDeviceId, relayUrl, handleMessage, setWs, setError]);

  /**
   * 断开连接
   */
  const disconnect = useCallback(() => {
    if (ws) {
      ws.close();
    }
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, [ws]);

  /**
   * 发起配对
   */
  const pair = useCallback(
    async (code: string): Promise<void> => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket 未连接');
      }
      if (!deviceId) {
        throw new Error('设备未注册');
      }

      const { keyPair } = useConnectionStore.getState();
      if (!keyPair) {
        throw new Error('密钥对未初始化');
      }

      setState('pairing');

      const pairPayload = JSON.stringify({
        code,
        publicKey: keyPair.publicKey,
      });
      const pairMessage = createTransportMessage('pair', deviceId, pairPayload);
      ws.send(JSON.stringify(pairMessage));
    },
    [ws, deviceId, setState]
  );

  /**
   * 发送应用层消息
   */
  const send = useCallback(
    async (message: AppMessage): Promise<void> => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket 未连接');
      }
      if (!deviceId || !daemonId) {
        throw new Error('未配对');
      }

      // 加密消息
      const encryptedPayload = await encrypt(message);

      // 创建传输层消息
      const transportMessage = createTransportMessage('message', deviceId, encryptedPayload, daemonId);
      ws.send(JSON.stringify(transportMessage));
    },
    [ws, deviceId, daemonId, encrypt]
  );

  // 清理心跳定时器
  useEffect(() => {
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, []);

  return {
    connect,
    disconnect,
    pair,
    send,
    isConnecting: state === 'connecting',
  };
}
