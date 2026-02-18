/**
 * 仪表盘页面
 *
 * - 当前活跃 daemon 的会话列表
 * - 终端交互
 * - 移动端快捷键栏
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SessionOptions } from '@mytermux/shared';
import { useConnectionStore } from '../stores/connectionStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useSessions } from '../hooks/useSessions';
import { useWebSocket } from '../hooks/useWebSocket';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { SessionList } from '../components/SessionList';
import { TerminalView } from '../components/TerminalView';
import { NewSessionDialog } from '../components/NewSessionDialog';
import { TerminalShortcutBar } from '../components/TerminalShortcutBar';
import { useWebPreferencesStore } from '../stores/webPreferencesStore';

export function DashboardPage() {
  const navigate = useNavigate();
  const [isNewSessionDialogOpen, setIsNewSessionDialogOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [terminalFocused, setTerminalFocused] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [softKeyboardVisible, setSoftKeyboardVisible] = useState(false);

  const {
    state: connectionState,
    daemonId,
    activeProfile,
    disconnect,
    setActiveProfile,
    error: connectionError,
  } = useConnectionStore();
  const { connectWithProfile, isConnecting } = useWebSocket();

  const {
    sessions,
    activeSessionId,
    getActiveSession,
  } = useSessionsStore();

  const {
    createSession,
    closeSession,
    refreshSessions,
    sendInput,
    resizeTerminal,
  } = useSessions();

  const {
    preferences,
    loadPreferences,
  } = useWebPreferencesStore();

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualDisconnectRef = useRef(false);

  const activeSession = getActiveSession();
  const isAuthenticated = connectionState === 'authenticated';
  const shouldWaitForConnection = !isAuthenticated && Boolean(activeProfile);

  const clearReconnectTimer = useCallback(() => {
    if (!reconnectTimerRef.current) {
      return;
    }

    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearReconnectTimer();
    };
  }, [clearReconnectTimer]);

  useEffect(() => {
    if (connectionState === 'authenticated') {
      manualDisconnectRef.current = false;
      clearReconnectTimer();
      return;
    }

    if (manualDisconnectRef.current) {
      return;
    }

    if (!activeProfile) {
      navigate('/daemons', { replace: true });
      return;
    }

    if (connectionState === 'connecting' || connectionState === 'authenticating') {
      return;
    }

    clearReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      void connectWithProfile(activeProfile).catch((error) => {
        console.warn('自动重连失败，稍后重试:', error);
      });
    }, 1200);
  }, [activeProfile, clearReconnectTimer, connectWithProfile, connectionState, navigate]);

  useEffect(() => {
    void loadPreferences().catch(() => undefined);
  }, [loadPreferences]);

  useEffect(() => {
    if (isAuthenticated) {
      void refreshSessions().catch((error) => {
        console.error('刷新会话列表失败:', error);
      });
    }
  }, [isAuthenticated, refreshSessions]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  useEffect(() => {
    if (!isTouchDevice || typeof window === 'undefined' || !window.visualViewport) {
      setSoftKeyboardVisible(false);
      return;
    }

    const viewport = window.visualViewport;
    const threshold = 120;
    let baselineHeight = viewport.height;

    const handleViewportResize = () => {
      if (viewport.height > baselineHeight) {
        baselineHeight = viewport.height;
      }

      setSoftKeyboardVisible(baselineHeight - viewport.height > threshold);
    };

    viewport.addEventListener('resize', handleViewportResize);
    handleViewportResize();

    return () => {
      viewport.removeEventListener('resize', handleViewportResize);
      setSoftKeyboardVisible(false);
    };
  }, [isTouchDevice]);

  const showShortcutBar = useMemo(() => {
    return Boolean(
      activeSessionId &&
      terminalFocused &&
      isTouchDevice &&
      softKeyboardVisible &&
      preferences,
    );
  }, [activeSessionId, terminalFocused, isTouchDevice, softKeyboardVisible, preferences]);

  const handleDisconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    clearReconnectTimer();
    setActiveProfile(null);
    disconnect();
    navigate('/daemons', { replace: true });
  }, [clearReconnectTimer, disconnect, navigate, setActiveProfile]);

  const handleCreateSession = useCallback(
    async (options?: SessionOptions) => {
      try {
        await createSession(options);
      } catch (error) {
        console.error('创建会话失败:', error);
      }
    },
    [createSession],
  );

  const handleCloseSession = useCallback(
    async (sessionId: string) => {
      try {
        await closeSession(sessionId);
      } catch (error) {
        console.error('关闭会话失败:', error);
      }
    },
    [closeSession],
  );

  const handleTerminalInput = useCallback(
    async (data: string) => {
      if (!activeSessionId) {
        return;
      }

      try {
        await sendInput(activeSessionId, data);
      } catch (error) {
        console.error('发送输入失败:', error);
      }
    },
    [activeSessionId, sendInput],
  );

  const handleTerminalResize = useCallback(
    async (cols: number, rows: number) => {
      if (!activeSessionId) {
        return;
      }

      try {
        await resizeTerminal(activeSessionId, cols, rows);
      } catch (error) {
        console.error('调整终端尺寸失败:', error);
      }
    },
    [activeSessionId, resizeTerminal],
  );

  return (
    <div className="h-screen bg-gray-950 flex overflow-hidden">
      <aside
        className={`
          flex flex-col bg-gray-900 border-r border-gray-800
          transition-all duration-300 ease-in-out
          ${isSidebarCollapsed ? 'w-16' : 'w-72'}
        `}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          {!isSidebarCollapsed && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                  />
                </svg>
              </div>
              <div>
                <span className="font-semibold text-gray-100 block leading-tight">MyTermux</span>
                <span className="text-[11px] text-gray-500">{activeProfile?.name || daemonId || '未选择 daemon'}</span>
              </div>
            </div>
          )}

          <button
            onClick={() => setIsSidebarCollapsed((prev) => !prev)}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            title={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            <svg
              className={`w-4 h-4 transition-transform ${isSidebarCollapsed ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
              />
            </svg>
          </button>
        </div>

        {!isSidebarCollapsed && (
          <div className="p-3 border-b border-gray-800 space-y-2">
            <button
              onClick={() => setIsNewSessionDialogOpen(true)}
              disabled={!isAuthenticated}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              新建会话
            </button>

            <button
              onClick={() => navigate('/daemons')}
              className="w-full rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:border-emerald-500"
            >
              切换 Daemon
            </button>
          </div>
        )}

        {isSidebarCollapsed && (
          <div className="p-2 border-b border-gray-800">
            <button
              onClick={() => setIsNewSessionDialogOpen(true)}
              disabled={!isAuthenticated}
              className="w-full flex items-center justify-center p-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
              title="新建会话"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        )}

        {!isSidebarCollapsed ? (
          <div className="flex-1 overflow-y-auto p-3">
            <SessionList onCloseSession={handleCloseSession} />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => useSessionsStore.getState().setActiveSession(session.id)}
                className={`
                  w-full flex items-center justify-center p-2 rounded-lg
                  transition-colors
                  ${session.id === activeSessionId ? 'bg-gray-700 border border-gray-600' : 'hover:bg-gray-800 border border-transparent'}
                `}
                title={session.title}
              >
                <div className="p-1 rounded-md text-emerald-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="p-3 border-t border-gray-800">
          {!isSidebarCollapsed ? (
            <div className="flex items-center justify-between gap-2">
              <ConnectionStatus />
              <button
                onClick={handleDisconnect}
                className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-900/30 transition-colors"
                title="断开连接"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={handleDisconnect}
              className="w-full p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-900/30 transition-colors"
              title="断开连接"
            >
              <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </button>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        {shouldWaitForConnection ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 px-6">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-emerald-400 animate-spin mb-4" />
            <h3 className="text-lg font-medium text-gray-200 mb-2">
              {connectionState === 'error' ? '连接已断开，正在重连...' : '正在连接会话...'}
            </h3>
            <p className="text-sm text-gray-500 text-center max-w-md">
              当前配置: {activeProfile?.name || daemonId || '未命名 daemon'}。
              {isConnecting ? ' 正在发起连接请求，请稍候。' : ' 将自动持续重试，直到连接恢复。'}
            </p>
            {connectionError && connectionState === 'error' && (
              <p className="mt-3 text-xs text-red-400 break-all text-center max-w-xl">{connectionError}</p>
            )}
            <button
              onClick={() => navigate('/daemons')}
              className="mt-6 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:border-emerald-500"
            >
              返回 Daemon 管理中心
            </button>
          </div>
        ) : activeSession ? (
          <>
            <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-900/50 text-emerald-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="font-medium text-gray-100">{activeSession.title}</h2>
                  <p className="text-xs text-gray-500">终端会话 · PID: {activeSession.pid ?? '-'}</p>
                </div>
              </div>
              <button
                onClick={() => void handleCloseSession(activeSession.id)}
                className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-900/30 transition-colors"
                title="关闭会话"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </header>

            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="flex-1 overflow-hidden">
                <TerminalView
                  sessionId={activeSession.id}
                  onInput={(data) => void handleTerminalInput(data)}
                  onResize={(cols, rows) => void handleTerminalResize(cols, rows)}
                  onFocusChange={setTerminalFocused}
                  disabled={activeSession.status !== 'running' || !isAuthenticated}
                  className="h-full"
                />
              </div>

              <TerminalShortcutBar
                visible={showShortcutBar}
                shortcuts={preferences?.shortcuts ?? []}
                commonChars={preferences?.commonChars ?? []}
                onSend={(value) => void handleTerminalInput(value)}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
            <svg className="w-20 h-20 mb-6 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <h3 className="text-xl font-medium text-gray-300 mb-2">
              {sessions.length === 0 ? '开始使用' : '选择一个会话'}
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              {sessions.length === 0
                ? '当前 daemon 暂无会话，可手动新建一个会话'
                : '从左侧列表选择一个会话，或手动创建新会话'}
            </p>
            <button
              onClick={() => setIsNewSessionDialogOpen(true)}
              disabled={!isAuthenticated}
              className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              新建会话
            </button>
          </div>
        )}
      </main>

      <NewSessionDialog
        isOpen={isNewSessionDialogOpen}
        onClose={() => setIsNewSessionDialogOpen(false)}
        onCreate={(options) => void handleCreateSession(options)}
      />
    </div>
  );
}
