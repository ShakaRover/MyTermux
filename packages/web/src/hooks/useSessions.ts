/**
 * 会话管理 Hook
 *
 * 封装终端会话相关操作，包括创建、关闭和输入发送
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  generateMessageId,
  type SessionOptions,
  type SessionCreateMessage,
  type SessionListMessage,
  type SessionCloseMessage,
  type SessionInputMessage,
  type SessionResizeMessage,
} from '@opentermux/shared';
import { useSessionsStore } from '../stores/sessionsStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useWebSocket } from './useWebSocket';
import { initializeGlobalMessageHandler } from './globalMessageHandler';

/** 会话 Hook 返回值 */
export interface UseSessionsReturn {
  /** 创建新会话 */
  createSession: (options?: SessionOptions) => Promise<void>;
  /** 关闭会话 */
  closeSession: (sessionId: string) => Promise<void>;
  /** 刷新会话列表 */
  refreshSessions: () => Promise<void>;
  /** 发送输入到会话 */
  sendInput: (sessionId: string, data: string) => Promise<void>;
  /** 调整终端尺寸 */
  resizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<void>;
}

/**
 * 会话管理 Hook
 *
 * 提供会话的 CRUD 操作和通信能力
 */
export function useSessions(): UseSessionsReturn {
  const { setLoading } = useSessionsStore();
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
    if (connectionState !== 'authenticated') {
      throw new Error('未连接到 daemon');
    }
  }, [connectionState]);

  /**
   * 创建新会话（仅 terminal）
   */
  const createSession = useCallback(
    async (options?: SessionOptions): Promise<void> => {
      checkConnection();

      const message: SessionCreateMessage = options
        ? {
            action: 'session:create',
            messageId: generateMessageId(),
            sessionType: 'terminal',
            options,
          }
        : {
            action: 'session:create',
            messageId: generateMessageId(),
            sessionType: 'terminal',
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

      const message: SessionInputMessage = {
        action: 'session:input',
        messageId: generateMessageId(),
        sessionId,
        data,
      };

      await send(message);
    },
    [checkConnection, send]
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

  return {
    createSession,
    closeSession,
    refreshSessions,
    sendInput,
    resizeTerminal,
  };
}
