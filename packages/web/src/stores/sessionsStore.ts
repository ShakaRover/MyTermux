/**
 * 会话状态管理 Store
 *
 * 管理所有活跃终端会话的状态
 */

import { create } from 'zustand';
import type { SessionInfo } from '@opentermux/shared';

/** 会话扩展信息 */
export interface SessionData extends SessionInfo {
  /** 终端会话的输出缓冲区 */
  terminalBuffer?: string;
}

/** 会话 Store 状态 */
export interface SessionsStoreState {
  /** 所有会话列表 */
  sessions: SessionData[];
  /** 当前活跃会话 ID */
  activeSessionId: string | null;
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
  /** 追加终端输出 */
  appendTerminalOutput: (sessionId: string, data: string) => void;
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
  isLoading: false,
};

/** 会话状态 Store */
export const useSessionsStore = create<SessionsStoreState & SessionsStoreActions>(
  (set, get) => ({
    ...initialState,

    setSessions: (sessions) =>
      set({
        sessions: sessions.map((s): SessionData => ({
          ...s,
          terminalBuffer: s.outputHistory ?? '',
        })),
      }),

    addSession: (session) =>
      set((state) => ({
        sessions: [...state.sessions, { ...session, terminalBuffer: '' }],
        // 自动切换到新会话
        activeSessionId: session.id,
      })),

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

    appendTerminalOutput: (sessionId, data) =>
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId
            ? { ...s, terminalBuffer: (s.terminalBuffer ?? '') + data }
            : s
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
