/**
 * 全局应用消息处理器
 *
 * 处理从 daemon 接收到的所有应用层消息
 * 这是一个单例模式，确保消息只被处理一次
 * 处理器被注册到 connectionStore 中，供 useWebSocket 统一调用
 */

import {
  type AppMessage,
  type SessionCreatedMessage,
  type SessionListResponseMessage,
  type SessionClosedMessage,
  type SessionOutputMessage,
  type PermissionRequestMessage,
} from '@mycc/shared';
import { useSessionsStore } from '../stores/sessionsStore';
import { useConnectionStore } from '../stores/connectionStore';

/** 消息处理器类型 */
export type AppMessageHandler = (message: AppMessage) => void;

/** 全局消息处理器实例 */
let globalHandler: AppMessageHandler | null = null;
let isInitialized = false;

/**
 * 初始化全局消息处理器
 * 只应该被调用一次
 * 将处理器注册到 connectionStore 中
 */
export function initializeGlobalMessageHandler(): void {
  if (isInitialized) {
    return;
  }

  globalHandler = (message: AppMessage) => {
    const store = useSessionsStore.getState();

    switch (message.action) {
      case 'session:created': {
        const msg = message as SessionCreatedMessage;
        store.addSession(msg.session);
        break;
      }

      case 'session:list_response': {
        const msg = message as SessionListResponseMessage;
        store.setSessions(msg.sessions);
        store.setLoading(false);
        break;
      }

      case 'session:closed': {
        const msg = message as SessionClosedMessage;
        store.removeSession(msg.sessionId);
        break;
      }

      case 'session:output': {
        const msg = message as SessionOutputMessage;
        // Claude Code 和终端会话都是 TUI 程序，统一使用终端缓冲区渲染
        store.appendTerminalOutput(msg.sessionId, msg.data);
        break;
      }

      case 'permission:request': {
        const msg = message as PermissionRequestMessage;
        store.addPermissionRequest(msg.request);
        break;
      }

      default:
        // 忽略其他消息类型
        break;
    }
  };

  // 将处理器注册到 connectionStore 中
  useConnectionStore.getState().setAppMessageHandler(globalHandler);

  isInitialized = true;
}

/**
 * 重置消息处理器（用于测试）
 */
export function resetGlobalMessageHandler(): void {
  globalHandler = null;
  isInitialized = false;
  // 同步清除 store 中的引用，避免悬空回调
  useConnectionStore.getState().setAppMessageHandler(null);
}
