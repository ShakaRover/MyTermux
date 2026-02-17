/**
 * 会话列表组件
 *
 * 显示所有活跃会话，支持切换和管理
 */

import { useSessionsStore, type SessionData } from '../stores/sessionsStore';

/** 会话图标 */
const sessionIcon = (
  <svg
    className="w-5 h-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
    />
  </svg>
);

/** 状态颜色配置 */
const statusColors = {
  starting: 'text-yellow-400',
  running: 'text-green-400',
  stopped: 'text-gray-400',
  error: 'text-red-400',
};

/** 会话列表 Props */
export interface SessionListProps {
  /** 关闭会话回调 */
  onCloseSession?: (sessionId: string) => void;
  /** 额外的 CSS 类名 */
  className?: string;
}

/**
 * 会话列表项组件
 */
function SessionListItem({
  session,
  isActive,
  onClick,
  onClose,
}: {
  session: SessionData;
  isActive: boolean;
  onClick: () => void;
  onClose?: (() => void) | undefined;
}) {
  return (
    <div
      className={`
        group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer
        transition-all duration-200
        ${
          isActive
            ? 'bg-gray-700 border border-gray-600'
            : 'hover:bg-gray-800 border border-transparent'
        }
      `}
      onClick={onClick}
    >
      {/* 会话图标 */}
      <div className="flex-shrink-0 p-1.5 rounded-md bg-emerald-900/50 text-emerald-400">
        {sessionIcon}
      </div>

      {/* 会话信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200 truncate">
            {session.title}
          </span>
          <span className={`text-xs ${statusColors[session.status]}`}>
            {session.status === 'running' && '●'}
            {session.status === 'starting' && '○'}
            {session.status === 'error' && '!'}
          </span>
        </div>
        <div className="text-xs text-gray-500 truncate">
          终端会话
          {' · '}
          PID: {session.pid ?? '-'}
          {' · '}
          {new Date(session.createdAt).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>

      {/* 关闭按钮 */}
      {onClose && (
        <button
          className={`
            flex-shrink-0 p-1 rounded-md text-gray-500
            opacity-0 group-hover:opacity-100
            hover:text-red-400 hover:bg-red-900/30
            transition-all duration-200
          `}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="关闭会话"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * 会话列表组件
 */
export function SessionList({ onCloseSession, className = '' }: SessionListProps) {
  const { sessions, activeSessionId, setActiveSession, isLoading } = useSessionsStore();

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center py-8 ${className}`}>
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-600 border-t-emerald-500" />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-8 text-gray-500 ${className}`}>
        <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
        <p className="text-sm">暂无会话</p>
        <p className="text-xs mt-1">点击上方按钮创建新会话</p>
      </div>
    );
  }

  return (
    <div className={`space-y-1 ${className}`}>
      {sessions.map((session) => (
        <SessionListItem
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          onClick={() => setActiveSession(session.id)}
          onClose={onCloseSession ? () => onCloseSession(session.id) : undefined}
        />
      ))}
    </div>
  );
}
