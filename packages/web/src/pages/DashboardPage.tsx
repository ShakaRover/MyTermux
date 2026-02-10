/**
 * 仪表盘页面
 *
 * 显示会话列表和会话交互区
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SessionType } from '@mycc/shared';
import { useConnectionStore } from '../stores/connectionStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useSessions } from '../hooks/useSessions';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { SessionList } from '../components/SessionList';
import { TerminalView } from '../components/TerminalView';
import { PermissionDialog } from '../components/PermissionDialog';
import { NewSessionDialog } from '../components/NewSessionDialog';

/**
 * 仪表盘页面组件
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const [isNewSessionDialogOpen, setIsNewSessionDialogOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const { state: connectionState, disconnect } = useConnectionStore();
  const { sessions, activeSessionId, permissionRequests, getActiveSession } =
    useSessionsStore();

  const {
    createSession,
    closeSession,
    refreshSessions,
    sendInput,
    resizeTerminal,
    respondPermission,
  } = useSessions();

  // 如果未配对，跳转到配对页面
  useEffect(() => {
    if (connectionState !== 'paired') {
      navigate('/pair');
    }
  }, [connectionState, navigate]);

  // 配对成功后刷新会话列表
  useEffect(() => {
    if (connectionState === 'paired') {
      refreshSessions().catch(console.error);
    }
  }, [connectionState, refreshSessions]);

  // 获取当前活跃会话
  const activeSession = getActiveSession();

  // 处理断开连接
  const handleDisconnect = useCallback(() => {
    disconnect();
    navigate('/pair');
  }, [disconnect, navigate]);

  // 处理创建会话
  const handleCreateSession = useCallback(
    async (type: SessionType, cwd?: string) => {
      try {
        await createSession(type, cwd ? { cwd } : undefined);
      } catch (err) {
        console.error('创建会话失败:', err);
      }
    },
    [createSession]
  );

  // 处理关闭会话
  const handleCloseSession = useCallback(
    async (sessionId: string) => {
      try {
        await closeSession(sessionId);
      } catch (err) {
        console.error('关闭会话失败:', err);
      }
    },
    [closeSession]
  );

  // 处理终端输入
  const handleTerminalInput = useCallback(
    async (data: string) => {
      if (!activeSessionId) return;
      try {
        await sendInput(activeSessionId, data);
      } catch (err) {
        console.error('发送输入失败:', err);
      }
    },
    [activeSessionId, sendInput]
  );

  // 处理终端尺寸变化
  const handleTerminalResize = useCallback(
    async (cols: number, rows: number) => {
      if (!activeSessionId) return;
      try {
        await resizeTerminal(activeSessionId, cols, rows);
      } catch (err) {
        console.error('调整终端尺寸失败:', err);
      }
    },
    [activeSessionId, resizeTerminal]
  );

  // 处理权限审批
  const handlePermissionApprove = useCallback(
    async (requestId: string) => {
      const request = permissionRequests.find((r) => r.id === requestId);
      if (!request) return;
      try {
        await respondPermission(request.sessionId, requestId, true);
      } catch (err) {
        console.error('审批权限失败:', err);
      }
    },
    [permissionRequests, respondPermission]
  );

  const handlePermissionReject = useCallback(
    async (requestId: string) => {
      const request = permissionRequests.find((r) => r.id === requestId);
      if (!request) return;
      try {
        await respondPermission(request.sessionId, requestId, false);
      } catch (err) {
        console.error('拒绝权限失败:', err);
      }
    },
    [permissionRequests, respondPermission]
  );

  // 当前待处理的权限请求
  const currentPermissionRequest = permissionRequests[0];

  return (
    <div className="h-screen bg-gray-950 flex overflow-hidden">
      {/* 侧边栏 */}
      <aside
        className={`
          flex flex-col bg-gray-900 border-r border-gray-800
          transition-all duration-300 ease-in-out
          ${isSidebarCollapsed ? 'w-16' : 'w-72'}
        `}
      >
        {/* 侧边栏头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          {!isSidebarCollapsed && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-purple-600/20 text-purple-400 flex items-center justify-center">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                  />
                </svg>
              </div>
              <span className="font-semibold text-gray-100">MyCC</span>
            </div>
          )}
          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
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

        {/* 新建会话按钮 */}
        {!isSidebarCollapsed && (
          <div className="p-3 border-b border-gray-800">
            <button
              onClick={() => setIsNewSessionDialogOpen(true)}
              className="
                w-full flex items-center justify-center gap-2 px-4 py-2.5
                bg-purple-600 hover:bg-purple-500 text-white rounded-lg
                font-medium transition-colors
              "
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              新建会话
            </button>
          </div>
        )}

        {isSidebarCollapsed && (
          <div className="p-2 border-b border-gray-800">
            <button
              onClick={() => setIsNewSessionDialogOpen(true)}
              className="
                w-full flex items-center justify-center p-2
                bg-purple-600 hover:bg-purple-500 text-white rounded-lg
                transition-colors
              "
              title="新建会话"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
          </div>
        )}

        {/* 会话列表 */}
        {!isSidebarCollapsed && (
          <div className="flex-1 overflow-y-auto p-3">
            <SessionList onCloseSession={handleCloseSession} />
          </div>
        )}

        {/* 底部状态栏 */}
        <div className="p-3 border-t border-gray-800">
          {!isSidebarCollapsed ? (
            <div className="flex items-center justify-between">
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

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {activeSession ? (
          <>
            {/* 会话头部 */}
            <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50">
              <div className="flex items-center gap-3">
                <div
                  className={`
                    p-2 rounded-lg
                    ${
                      activeSession.type === 'claude'
                        ? 'bg-purple-900/50 text-purple-400'
                        : 'bg-emerald-900/50 text-emerald-400'
                    }
                  `}
                >
                  {activeSession.type === 'claude' ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                      />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                  )}
                </div>
                <div>
                  <h2 className="font-medium text-gray-100">{activeSession.title}</h2>
                  <p className="text-xs text-gray-500">
                    {activeSession.type === 'claude' ? 'Claude 对话' : '终端会话'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleCloseSession(activeSession.id)}
                className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-900/30 transition-colors"
                title="关闭会话"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </header>

            {/* 会话内容 - Claude Code 和终端都是 TUI 程序，统一使用 TerminalView */}
            <div className="flex-1 overflow-hidden">
              <TerminalView
                sessionId={activeSession.id}
                onInput={handleTerminalInput}
                onResize={handleTerminalResize}
                disabled={activeSession.status !== 'running'}
                className="h-full"
              />
            </div>
          </>
        ) : (
          // 无活跃会话时的占位内容
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
            <svg
              className="w-20 h-20 mb-6 opacity-30"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
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
                ? '创建一个新的 Claude 对话或终端会话'
                : '从左侧列表选择一个会话，或创建新会话'}
            </p>
            <button
              onClick={() => setIsNewSessionDialogOpen(true)}
              className="
                inline-flex items-center gap-2 px-6 py-3
                bg-purple-600 hover:bg-purple-500 text-white rounded-lg
                font-medium transition-colors
              "
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              新建会话
            </button>
          </div>
        )}
      </main>

      {/* 新建会话对话框 */}
      <NewSessionDialog
        isOpen={isNewSessionDialogOpen}
        onClose={() => setIsNewSessionDialogOpen(false)}
        onCreate={handleCreateSession}
      />

      {/* 权限审批弹窗 */}
      {currentPermissionRequest && (
        <PermissionDialog
          request={currentPermissionRequest}
          onApprove={handlePermissionApprove}
          onReject={handlePermissionReject}
        />
      )}
    </div>
  );
}
