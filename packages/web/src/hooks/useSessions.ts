/**
 * 会话管理 Hook
 *
 * 封装会话相关的操作，包括创建、关闭、发送消息等
 */

import { useCallback } from 'react';
import {
  generateMessageId,
  type SessionType,
  type SessionOptions,
  type AppMessage,
  type SessionCreateMessage,
  type SessionListMessage,
  type SessionCloseMessage,
  type SessionInputMessage,
  type SessionResizeMessage,
  type PermissionRespondMessage,
  type SessionCreatedMessage,
  type SessionListResponseMessage,
  type SessionClosedMessage,
  type SessionOutputMessage,
  type PermissionRequestMessage,
} from '@mycc/shared';
import { useSessionsStore, type ChatMessage } from '../stores/sessionsStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useWebSocket } from './useWebSocket';

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
    addSession,
    removeSession,
    setSessions,
    addMessage,
    appendTerminalOutput,
    addPermissionRequest,
    removePermissionRequest,
    setLoading,
  } = useSessionsStore();

  const { state: connectionState } = useConnectionStore();

  /**
   * 处理应用层消息
   */
  const handleAppMessage = useCallback(
    (message: AppMessage) => {
      switch (message.action) {
        case 'session:created': {
          const msg = message as SessionCreatedMessage;
          addSession(msg.session);
          break;
        }

        case 'session:list_response': {
          const msg = message as SessionListResponseMessage;
          setSessions(msg.sessions);
          setLoading(false);
          break;
        }

        case 'session:closed': {
          const msg = message as SessionClosedMessage;
          removeSession(msg.sessionId);
          break;
        }

        case 'session:output': {
          const msg = message as SessionOutputMessage;
          // 根据会话类型处理输出
          const sessions = useSessionsStore.getState().sessions;
          const session = sessions.find((s) => s.id === msg.sessionId);

          if (session) {
            if (session.type === 'terminal') {
              appendTerminalOutput(msg.sessionId, msg.data);
            } else {
              // Claude 会话，解析为消息
              try {
                const chatMessage: ChatMessage = {
                  id: generateMessageId(),
                  role: 'assistant',
                  content: msg.data,
                  timestamp: Date.now(),
                };
                addMessage(msg.sessionId, chatMessage);
              } catch {
                // 如果不是 JSON，直接作为消息内容
                const chatMessage: ChatMessage = {
                  id: generateMessageId(),
                  role: 'assistant',
                  content: msg.data,
                  timestamp: Date.now(),
                };
                addMessage(msg.sessionId, chatMessage);
              }
            }
          }
          break;
        }

        case 'permission:request': {
          const msg = message as PermissionRequestMessage;
          addPermissionRequest(msg.request);
          break;
        }

        default:
          // 忽略其他消息类型
          break;
      }
    },
    [addSession, setSessions, setLoading, removeSession, appendTerminalOutput, addMessage, addPermissionRequest]
  );

  const { send } = useWebSocket({
    onAppMessage: handleAppMessage,
  });

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
