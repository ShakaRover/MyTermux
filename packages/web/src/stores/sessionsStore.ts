/**
 * 会话状态管理 Store
 *
 * 管理所有活跃会话的状态，包括 Claude 和终端会话
 */

import { create } from 'zustand';
import type { SessionInfo, PermissionRequest } from '@mycc/shared';

/** 消息类型 */
export interface ChatMessage {
  /** 消息 ID */
  id: string;
  /** 发送者角色 */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string;
  /** 时间戳 */
  timestamp: number;
}

/** 会话扩展信息（包含消息历史） */
export interface SessionData extends SessionInfo {
  /** Claude 会话的消息历史 */
  messages?: ChatMessage[];
  /** 终端会话的输出缓冲区 */
  terminalBuffer?: string;
}

/** 会话 Store 状态 */
export interface SessionsStoreState {
  /** 所有会话列表 */
  sessions: SessionData[];
  /** 当前活跃会话 ID */
  activeSessionId: string | null;
  /** 待处理的权限请求 */
  permissionRequests: PermissionRequest[];
  /** 是否正在加载会话列表 */
  isLoading: boolean;
}

/** 会话 Store 操作 */
export interface SessionsStoreActions {
  /** 设置会话列表 */
  setSessions: (sessions: SessionInfo[]) => void;
  /** 添加新会话 */
  addSession: (session: SessionInfo) => void;
  /** 更新会话信息 */
  updateSession: (sessionId: string, updates: Partial<SessionData>) => void;
  /** 移除会话 */
  removeSession: (sessionId: string) => void;
  /** 设置当前活跃会话 */
  setActiveSession: (sessionId: string | null) => void;
  /** 添加消息到 Claude 会话 */
  addMessage: (sessionId: string, message: ChatMessage) => void;
  /** 追加终端输出 */
  appendTerminalOutput: (sessionId: string, data: string) => void;
  /** 添加权限请求 */
  addPermissionRequest: (request: PermissionRequest) => void;
  /** 移除权限请求 */
  removePermissionRequest: (requestId: string) => void;
  /** 更新权限请求状态 */
  updatePermissionRequest: (requestId: string, updates: Partial<PermissionRequest>) => void;
  /** 设置加载状态 */
  setLoading: (isLoading: boolean) => void;
  /** 获取当前活跃会话 */
  getActiveSession: () => SessionData | undefined;
  /** 清空所有会话 */
  clearSessions: () => void;
}

/** 初始状态 */
const initialState: SessionsStoreState = {
  sessions: [],
  activeSessionId: null,
  permissionRequests: [],
  isLoading: false,
};

/** 会话状态 Store */
export const useSessionsStore = create<SessionsStoreState & SessionsStoreActions>(
  (set, get) => ({
    ...initialState,

    setSessions: (sessions) =>
      set({
        sessions: sessions.map((s): SessionData => {
          if (s.type === 'claude') {
            return { ...s, messages: [] };
          }
          return { ...s, terminalBuffer: '' };
        }),
      }),

    addSession: (session) =>
      set((state) => {
        const newSession: SessionData =
          session.type === 'claude'
            ? { ...session, messages: [] }
            : { ...session, terminalBuffer: '' };
        return {
          sessions: [...state.sessions, newSession],
          // 自动切换到新会话
          activeSessionId: session.id,
        };
      }),

    updateSession: (sessionId, updates) =>
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, ...updates } : s
        ),
      })),

    removeSession: (sessionId) =>
      set((state) => {
        const newSessions = state.sessions.filter((s) => s.id !== sessionId);
        return {
          sessions: newSessions,
          // 如果删除的是当前活跃会话，切换到第一个会话
          activeSessionId:
            state.activeSessionId === sessionId
              ? newSessions[0]?.id ?? null
              : state.activeSessionId,
        };
      }),

    setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

    addMessage: (sessionId, message) =>
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId && s.messages
            ? { ...s, messages: [...s.messages, message] }
            : s
        ),
      })),

    appendTerminalOutput: (sessionId, data) =>
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId && s.terminalBuffer !== undefined
            ? { ...s, terminalBuffer: s.terminalBuffer + data }
            : s
        ),
      })),

    addPermissionRequest: (request) =>
      set((state) => ({
        permissionRequests: [...state.permissionRequests, request],
      })),

    removePermissionRequest: (requestId) =>
      set((state) => ({
        permissionRequests: state.permissionRequests.filter(
          (r) => r.id !== requestId
        ),
      })),

    updatePermissionRequest: (requestId, updates) =>
      set((state) => ({
        permissionRequests: state.permissionRequests.map((r) =>
          r.id === requestId ? { ...r, ...updates } : r
        ),
      })),

    setLoading: (isLoading) => set({ isLoading }),

    getActiveSession: () => {
      const { sessions, activeSessionId } = get();
      return sessions.find((s) => s.id === activeSessionId);
    },

    clearSessions: () => set(initialState),
  })
);
