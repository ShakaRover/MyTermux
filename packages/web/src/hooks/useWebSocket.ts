/**
 * WebSocket 连接 Hook
 *
 * 管理与中继服务器的 WebSocket 连接，处理 Token 认证和消息路由
 * 支持令牌认证和自动重连
 */

import { useCallback, useRef, useEffect } from 'react';
import {
  createTransportMessage,
  generateMessageId,
  isTransportMessage,
  type AppMessage,
} from '@mycc/shared';
import { useConnectionStore } from '../stores/connectionStore';
import { useEncryption } from './useEncryption';

/** 重连配置 */
const RECONNECT_CONFIG = {
  /** 初始重连延迟（毫秒） */
  initialDelay: 1000,
  /** 最大重连延迟（毫秒） */
  maxDelay: 30000,
  /** 最大重连次数 */
  maxAttempts: 10,
  /** 心跳间隔（毫秒） */
  heartbeatInterval: 30000,
} as const;

/** WebSocket Hook 配置 */
export interface UseWebSocketOptions {
  /** 收到应用层消息时的回调 */
  onAppMessage?: (message: AppMessage) => void;
  /** 连接建立时的回调 */
  onConnected?: () => void;
  /** 连接断开时的回调 */
  onDisconnected?: () => void;
  /** 认证成功时的回调 */
  onPaired?: (daemonId: string) => void;
  /** 发生错误时的回调 */
  onError?: (error: string) => void;
  /** 重连中回调 */
  onReconnecting?: (attempt: number) => void;
}

/** WebSocket Hook 返回值 */
export interface UseWebSocketReturn {
  /** 连接到中继服务器 */
  connect: () => Promise<void>;
  /** 使用保存的令牌重连 */
  reconnectWithToken: () => Promise<boolean>;
  /** 断开连接 */
  disconnect: () => void;
  /** 使用 Access Token 认证 */
  authenticate: (accessToken: string) => Promise<void>;
  /** 发送应用层消息 */
  send: (message: AppMessage) => Promise<void>;
  /** 是否正在连接 */
  isConnecting: boolean;
  /** 是否有保存的配对令牌 */
  hasSavedPairing: boolean;
  /** 清除保存的配对信息 */
  clearSavedPairing: () => void;
}

/**
 * WebSocket 连接 Hook
 *
 * 处理 WebSocket 连接生命周期、Token 认证流程和加密通信
 * 支持令牌认证和自动重连
 */
export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const { onAppMessage, onConnected, onDisconnected, onPaired, onError, onReconnecting } = options;

  const {
    state,
    deviceId,
    daemonId,
    ws,
    _hasSavedPairing,
    restoreFromStorage,
    clearStorage,
  } = useConnectionStore();

  const { initKeyPair, deriveSharedKey, encrypt, decrypt } = useEncryption();

  // 使用 ref 存储回调，避免闭包问题
  const callbacksRef = useRef({ onAppMessage, onConnected, onDisconnected, onPaired, onError, onReconnecting });
  callbacksRef.current = { onAppMessage, onConnected, onDisconnected, onPaired, onError, onReconnecting };

  // 心跳定时器
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 重连状态
  const reconnectRef = useRef({
    attempt: 0,
    timer: null as ReturnType<typeof setTimeout> | null,
    shouldReconnect: false,
    usingToken: false,
  });

  /** Token 重连函数签名 */
  type ConnectWithTokenFn = (
    tokenDeviceId: string,
    tokenKeyPair: { publicKey: string; privateKey: CryptoKey },
    tokenAccessToken: string,
  ) => void;

  // 通过 ref 引用 doConnectWithToken，打破 scheduleReconnect ↔ doConnectWithToken 循环依赖
  // 初始值为 throw，防止竞态条件下未初始化调用
  const doConnectWithTokenRef = useRef<ConnectWithTokenFn>(
    () => { throw new Error('doConnectWithToken 尚未初始化'); }
  );

  /**
   * 清理心跳和重连定时器
   */
  const cleanup = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (reconnectRef.current.timer) {
      clearTimeout(reconnectRef.current.timer);
      reconnectRef.current.timer = null;
    }
  }, []);

  /**
   * 启动心跳
   */
  const startHeartbeat = useCallback((socket: WebSocket, currentDeviceId: string) => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
    }
    heartbeatRef.current = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        const heartbeat = createTransportMessage('heartbeat', currentDeviceId, '');
        socket.send(JSON.stringify(heartbeat));
      }
    }, RECONNECT_CONFIG.heartbeatInterval);
  }, []);

  /**
   * 处理收到的消息
   *
   * I4: 使用 useConnectionStore.getState() 获取最新状态，
   * 避免 Zustand hook 解构的方法引用不稳定导致 useCallback 频繁重建
   */
  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      const store = useConnectionStore.getState();
      try {
        const data = JSON.parse(event.data as string);
        if (!isTransportMessage(data)) {
          console.warn('收到无效的传输层消息:', data);
          return;
        }

        switch (data.type) {
          case 'token_ack': {
            // Token 认证确认（统一处理首次认证和重连）
            let payload: {
              success: boolean;
              daemonId?: string;
              publicKey?: string;
              error?: string;
            };
            try {
              payload = JSON.parse(data.payload) as typeof payload;
            } catch {
              // C3: 解析失败时将状态从 pairing 恢复为 disconnected
              store.setState('disconnected');
              store.setError('认证响应格式错误');
              callbacksRef.current.onError?.('认证响应格式错误');
              break;
            }

            if (payload.success && payload.publicKey) {
              try {
                // 派生共享密钥
                await deriveSharedKey(payload.publicKey);

                // 如果响应中包含 daemonId，更新本地存储
                if (payload.daemonId) {
                  store.setDaemonId(payload.daemonId);
                }

                store.setState('paired');

                // 保存认证信息到本地存储
                await store.savePairingToStorage();

                // 重置重连计数
                reconnectRef.current.attempt = 0;
                reconnectRef.current.shouldReconnect = true;

                // S3: 简化 daemonId 获取逻辑
                const currentDaemonId = payload.daemonId ?? useConnectionStore.getState().daemonId;
                if (currentDaemonId) {
                  callbacksRef.current.onPaired?.(currentDaemonId);
                }
              } catch (err) {
                store.setState('connected');
                const errorMsg = err instanceof Error ? err.message : '密钥派生失败';
                store.setError(errorMsg);
                callbacksRef.current.onError?.(errorMsg);
              }
            } else {
              // C2: 认证失败后 relay 会关闭连接(4001)，直接设为 disconnected 避免状态跳变
              store.clearStorage();
              store.setState('disconnected');
              const errorMsg = payload.error || '认证失败，请检查 Access Token';
              store.setError(errorMsg);
              callbacksRef.current.onError?.(errorMsg);
            }
            break;
          }

          case 'message': {
            // 加密的应用层消息
            if (data.payload) {
              try {
                const appMessage = await decrypt<AppMessage>(data.payload);
                // 优先使用 store 中的全局消息处理器，然后是本地回调
                const globalHandler = useConnectionStore.getState().appMessageHandler;
                if (globalHandler) {
                  globalHandler(appMessage);
                }
                callbacksRef.current.onAppMessage?.(appMessage);
              } catch (err) {
                console.error('解密消息失败:', err);
                // I8: 解密持续失败通常意味着密钥不匹配，提示用户重新认证
                const errorMsg = '消息解密失败，密钥可能已失效，请重新认证';
                store.setError(errorMsg);
                callbacksRef.current.onError?.(errorMsg);
              }
            }
            break;
          }

          case 'error': {
            let payload: { code: string; message: string };
            try {
              payload = JSON.parse(data.payload) as typeof payload;
              store.setError(payload.message);
              callbacksRef.current.onError?.(payload.message);
            } catch {
              // S11: 保留原始 payload 信息便于调试
              const errorMsg = `收到错误消息，格式无效: ${data.payload}`;
              store.setError(errorMsg);
              callbacksRef.current.onError?.(errorMsg);
            }
            break;
          }

          case 'heartbeat': {
            // 心跳响应，忽略
            break;
          }

          default:
            console.warn('未知消息类型:', data.type);
        }
      } catch (err) {
        console.error('处理消息失败:', err);
        const errorMsg = err instanceof Error ? err.message : '消息处理异常';
        store.setError(errorMsg);
        callbacksRef.current.onError?.(errorMsg);
      }
    },
    [deriveSharedKey, decrypt]
  );

  /**
   * 调度重连
   */
  const scheduleReconnect = useCallback(() => {
    if (!reconnectRef.current.shouldReconnect) {
      return;
    }

    if (reconnectRef.current.attempt >= RECONNECT_CONFIG.maxAttempts) {
      console.log('达到最大重连次数，停止重连');
      reconnectRef.current.shouldReconnect = false;
      const store = useConnectionStore.getState();
      // I1: 同步设置 error 状态
      store.setState('error');
      store.setError('连接已断开，请刷新页面重试');
      callbacksRef.current.onError?.('连接已断开，请刷新页面重试');
      return;
    }

    const delay = Math.min(
      RECONNECT_CONFIG.initialDelay * Math.pow(2, reconnectRef.current.attempt),
      RECONNECT_CONFIG.maxDelay
    );

    reconnectRef.current.attempt++;
    callbacksRef.current.onReconnecting?.(reconnectRef.current.attempt);
    console.log(`正在重连... (第 ${reconnectRef.current.attempt} 次尝试, ${delay}ms 后)`);

    reconnectRef.current.timer = setTimeout(() => {
      try {
        // S5: 提取重连信息完整性检查
        if (!reconnectRef.current.usingToken) {
          // 普通连接断开后无法自动重连
          console.warn('普通连接断开，无法自动重连');
          reconnectRef.current.shouldReconnect = false;
          return;
        }

        const store = useConnectionStore.getState();
        if (!store.deviceId || !store.keyPair || !store.daemonId || !store.accessToken) {
          console.warn('重连所需信息不完整，停止重连');
          reconnectRef.current.shouldReconnect = false;
          return;
        }

        doConnectWithTokenRef.current(store.deviceId, store.keyPair, store.accessToken);
      } catch (error) {
        console.error('重连失败:', error);
        // S10: 递归调用 scheduleReconnect 已自带指数退避延迟，无需额外 delay
        scheduleReconnect();
      }
    }, delay);
  }, []);

  /**
   * 为 WebSocket 安装公共事件处理器（onmessage / onclose / onerror）
   * @param socket WebSocket 实例
   * @param shouldAutoReconnect onclose 时判断是否触发自动重连
   */
  const setupSocketHandlers = useCallback(
    (socket: WebSocket, shouldAutoReconnect: () => boolean) => {
      socket.onmessage = (event) => {
        handleMessage(event).catch((err) => {
          console.error('消息处理未捕获错误:', err);
          const errorMsg = err instanceof Error ? err.message : '消息处理异常';
          const store = useConnectionStore.getState();
          store.setError(errorMsg);
          callbacksRef.current.onError?.(errorMsg);
        });
      };

      socket.onclose = () => {
        const store = useConnectionStore.getState();

        // 必须在 cleanup() 之前检查：如果当前 store 中的 ws 已被替换为新实例，
        // 说明这是旧连接被 relay 关闭（同一 deviceId 重新注册），
        // 不应清理定时器（新连接正在使用），也不应触发状态变更和重连，
        // 否则会清掉新连接的心跳导致 relay 超时断开，或触发无限重连循环
        if (store.ws !== null && store.ws !== socket) {
          console.log('旧 WebSocket 关闭（已被新连接替换），跳过清理和重连');
          return;
        }

        cleanup();
        store.setState('disconnected');
        store.setWs(null);
        callbacksRef.current.onDisconnected?.();

        if (shouldAutoReconnect()) {
          scheduleReconnect();
        }
      };

      socket.onerror = () => {
        const errorMsg = 'WebSocket 连接错误';
        const store = useConnectionStore.getState();
        store.setError(errorMsg);
        callbacksRef.current.onError?.(errorMsg);
      };
    },
    [cleanup, handleMessage, scheduleReconnect]
  );

  /**
   * 使用令牌建立连接（内部方法）
   *
   * 注意：此方法仅负责建立 WebSocket 连接并发送 token_auth 消息。
   * 认证结果由 handleMessage 中的 token_ack 分支异步驱动，
   * 不通过 Promise 返回认证成败，避免 onopen 过早 resolve 的语义问题。
   */
  const doConnectWithToken = useCallback(
    (tokenDeviceId: string, tokenKeyPair: { publicKey: string; privateKey: CryptoKey }, tokenAccessToken: string): void => {
      const currentRelayUrl = useConnectionStore.getState().relayUrl;
      const socket = new WebSocket(currentRelayUrl);

      socket.onopen = () => {
        // 发送令牌认证消息（重连时使用保存的 accessToken）
        const tokenPayload = JSON.stringify({
          deviceType: 'client',
          publicKey: tokenKeyPair.publicKey,
          accessToken: tokenAccessToken,
        });
        const tokenMessage = createTransportMessage('token_auth', tokenDeviceId, tokenPayload);
        socket.send(JSON.stringify(tokenMessage));

        useConnectionStore.getState().setState('pairing'); // 等待 token_ack
        startHeartbeat(socket, tokenDeviceId);
        callbacksRef.current.onConnected?.();
      };

      setupSocketHandlers(socket, () => reconnectRef.current.shouldReconnect);
      useConnectionStore.getState().setWs(socket);
    },
    [setupSocketHandlers, startHeartbeat]
  );

  // 保持 doConnectWithTokenRef 与最新实例同步
  doConnectWithTokenRef.current = doConnectWithToken;

  /**
   * 使用保存的令牌重连
   *
   * 返回 true 表示已发起重连（不代表认证成功，认证结果通过 onPaired 回调通知）
   */
  const reconnectWithToken = useCallback(async (): Promise<boolean> => {
    // 尝试从本地存储恢复
    const restored = await restoreFromStorage();
    if (!restored) {
      return false;
    }

    const store = useConnectionStore.getState();
    if (!store.deviceId || !store.keyPair || !store.daemonId || !store.accessToken) {
      return false;
    }

    store.setState('connecting');
    reconnectRef.current.usingToken = true;
    reconnectRef.current.shouldReconnect = true;

    try {
      doConnectWithToken(store.deviceId, store.keyPair, store.accessToken);
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '令牌重连失败';
      console.error('令牌重连失败:', error);
      store.setError(errorMsg);
      store.setState('error');
      callbacksRef.current.onError?.(errorMsg);
      return false;
    }
  }, [doConnectWithToken, restoreFromStorage]);

  /**
   * 连接到中继服务器（等待用户输入 Access Token）
   */
  const connect = useCallback(async (): Promise<void> => {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const store = useConnectionStore.getState();
    store.setState('connecting');
    reconnectRef.current.usingToken = false;

    try {
      // 生成密钥对
      const newKeyPair = await initKeyPair();

      // 生成设备 ID
      const newDeviceId = `client-${generateMessageId()}`;
      store.setDeviceId(newDeviceId);

      // 创建 WebSocket 连接
      const socket = new WebSocket(store.relayUrl);

      socket.onopen = () => {
        // 发送注册消息
        const registerPayload = JSON.stringify({
          deviceType: 'client',
          publicKey: newKeyPair.publicKey,
        });
        const registerMessage = createTransportMessage('register', newDeviceId, registerPayload);
        socket.send(JSON.stringify(registerMessage));

        useConnectionStore.getState().setState('connected');
        startHeartbeat(socket, newDeviceId);
        callbacksRef.current.onConnected?.();
      };

      setupSocketHandlers(
        socket,
        () => reconnectRef.current.shouldReconnect && reconnectRef.current.usingToken
      );
      store.setWs(socket);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '连接失败';
      const s = useConnectionStore.getState();
      s.setError(errorMessage);
      s.setState('error');
      callbacksRef.current.onError?.(errorMessage);
    }
  }, [ws, initKeyPair, setupSocketHandlers, startHeartbeat]);

  /**
   * 断开连接
   */
  const disconnect = useCallback(() => {
    reconnectRef.current.shouldReconnect = false;
    cleanup();
    if (ws) {
      ws.close();
    }
  }, [ws, cleanup]);

  /**
   * 使用 Access Token 进行认证
   */
  const authenticate = useCallback(
    async (accessToken: string): Promise<void> => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket 未连接');
      }
      if (!deviceId) {
        throw new Error('设备未注册');
      }

      const store = useConnectionStore.getState();
      const currentKeyPair = store.keyPair;
      if (!currentKeyPair) {
        throw new Error('密钥对未初始化');
      }

      store.setState('pairing');
      reconnectRef.current.usingToken = true; // 认证成功后将使用令牌重连

      // 保存 accessToken 到 store，供重连时使用
      store.setAccessToken(accessToken);

      const tokenPayload = JSON.stringify({
        deviceType: 'client',
        publicKey: currentKeyPair.publicKey,
        accessToken,
      });
      const tokenMessage = createTransportMessage('token_auth', deviceId, tokenPayload);
      ws.send(JSON.stringify(tokenMessage));
    },
    [ws, deviceId]
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
        throw new Error('未认证');
      }

      // 加密消息
      const encryptedPayload = await encrypt(message);

      // 创建传输层消息
      const transportMessage = createTransportMessage('message', deviceId, encryptedPayload, daemonId);
      ws.send(JSON.stringify(transportMessage));
    },
    [ws, deviceId, daemonId, encrypt]
  );

  // 组件卸载时清理心跳和重连定时器
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    connect,
    reconnectWithToken,
    disconnect,
    authenticate,
    send,
    isConnecting: state === 'connecting',
    hasSavedPairing: _hasSavedPairing,
    clearSavedPairing: clearStorage,
  };
}
