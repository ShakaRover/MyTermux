/**
 * 会话管理 Hook
 *
 * 封装会话相关的操作，包括创建、关闭、发送消息等
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  generateMessageId,
  type SessionType,
  type SessionOptions,
  type SessionCreateMessage,
  type SessionListMessage,
  type SessionCloseMessage,
  type SessionInputMessage,
  type SessionResizeMessage,
  type PermissionRespondMessage,
} from '@mycc/shared';
import { useSessionsStore, type ChatMessage } from '../stores/sessionsStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useWebSocket } from './useWebSocket';
import { initializeGlobalMessageHandler } from './globalMessageHandler';

/** 会话 Hook 返回值 */
export interface UseSessionsReturn {
  /** 创建新会话 */
  createSession: (type: SessionType, options?: SessionOptions) => Promise<void>;
  /** 关闭会话 */
  closeSession: (sessionId: string) => Promise<void>;
  /** 刷新会话列表 */
  refreshSessions: () => Promise<void>;
  /** 发送输入到会话 */
  sendInput: (sessionId: string, data: string) => Promise<void>;
  /** 调整终端尺寸 */
  resizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<void>;
  /** 响应权限请求 */
  respondPermission: (sessionId: string, requestId: string, approved: boolean) => Promise<void>;
}

/**
 * 会话管理 Hook
 *
 * 提供会话的 CRUD 操作和通信功能
 */
export function useSessions(): UseSessionsReturn {
  const {
    addMessage,
    removePermissionRequest,
    setLoading,
  } = useSessionsStore();

  const { state: connectionState } = useConnectionStore();

  // 确保全局消息处理器只初始化一次
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      initializeGlobalMessageHandler();
      initializedRef.current = true;
    }
  }, []);

  // 使用 WebSocket hook（全局消息处理器已注册到 store 中）
  const { send } = useWebSocket();

  /**
   * 检查连接状态
   */
  const checkConnection = useCallback(() => {
    if (connectionState !== 'paired') {
      throw new Error('未连接到 daemon');
    }
  }, [connectionState]);

  /**
   * 创建新会话
   */
  const createSession = useCallback(
    async (type: SessionType, options?: SessionOptions): Promise<void> => {
      checkConnection();

      const message: SessionCreateMessage = options
        ? {
            action: 'session:create',
            messageId: generateMessageId(),
            sessionType: type,
            options,
          }
        : {
            action: 'session:create',
            messageId: generateMessageId(),
            sessionType: type,
          };

      await send(message);
    },
    [checkConnection, send]
  );

  /**
   * 关闭会话
   */
  const closeSession = useCallback(
    async (sessionId: string): Promise<void> => {
      checkConnection();

      const message: SessionCloseMessage = {
        action: 'session:close',
        messageId: generateMessageId(),
        sessionId,
      };

      await send(message);
    },
    [checkConnection, send]
  );

  /**
   * 刷新会话列表
   */
  const refreshSessions = useCallback(async (): Promise<void> => {
    checkConnection();
    setLoading(true);

    const message: SessionListMessage = {
      action: 'session:list',
      messageId: generateMessageId(),
    };

    await send(message);
  }, [checkConnection, setLoading, send]);

  /**
   * 发送输入到会话
   */
  const sendInput = useCallback(
    async (sessionId: string, data: string): Promise<void> => {
      checkConnection();

      // 如果是 Claude 会话，添加用户消息到本地状态
      const sessions = useSessionsStore.getState().sessions;
      const session = sessions.find((s) => s.id === sessionId);

      if (session?.type === 'claude') {
        const userMessage: ChatMessage = {
          id: generateMessageId(),
          role: 'user',
          content: data,
          timestamp: Date.now(),
        };
        addMessage(sessionId, userMessage);
      }

      const message: SessionInputMessage = {
        action: 'session:input',
        messageId: generateMessageId(),
        sessionId,
        data,
      };

      await send(message);
    },
    [checkConnection, addMessage, send]
  );

  /**
   * 调整终端尺寸
   */
  const resizeTerminal = useCallback(
    async (sessionId: string, cols: number, rows: number): Promise<void> => {
      checkConnection();

      const message: SessionResizeMessage = {
        action: 'session:resize',
        messageId: generateMessageId(),
        sessionId,
        cols,
        rows,
      };

      await send(message);
    },
    [checkConnection, send]
  );

  /**
   * 响应权限请求
   */
  const respondPermission = useCallback(
    async (sessionId: string, requestId: string, approved: boolean): Promise<void> => {
      checkConnection();

      const message: PermissionRespondMessage = {
        action: 'permission:respond',
        messageId: generateMessageId(),
        sessionId,
        requestId,
        approved,
      };

      await send(message);

      // 移除本地权限请求
      removePermissionRequest(requestId);
    },
    [checkConnection, send, removePermissionRequest]
  );

  return {
    createSession,
    closeSession,
    refreshSessions,
    sendInput,
    resizeTerminal,
    respondPermission,
  };
}
