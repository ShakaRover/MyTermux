/**
 * 连接状态指示器组件
 *
 * 显示与 daemon 的连接状态
 */

import { useConnectionStore, type ConnectionState } from '../stores/connectionStore';

/** 状态配置 */
const stateConfig: Record<
  ConnectionState,
  { label: string; color: string; bgColor: string; pulse?: boolean }
> = {
  disconnected: {
    label: '未连接',
    color: 'text-gray-400',
    bgColor: 'bg-gray-500',
  },
  connecting: {
    label: '连接中...',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500',
    pulse: true,
  },
  connected: {
    label: '已连接中继',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500',
  },
  pairing: {
    label: '配对中...',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500',
    pulse: true,
  },
  paired: {
    label: '已配对',
    color: 'text-green-400',
    bgColor: 'bg-green-500',
  },
  error: {
    label: '连接错误',
    color: 'text-red-400',
    bgColor: 'bg-red-500',
  },
};

/** 连接状态指示器 Props */
export interface ConnectionStatusProps {
  /** 是否显示详细信息 */
  showDetails?: boolean;
  /** 额外的 CSS 类名 */
  className?: string;
}

/**
 * 连接状态指示器组件
 */
export function ConnectionStatus({
  showDetails = false,
  className = '',
}: ConnectionStatusProps) {
  const { state, error, daemonId } = useConnectionStore();
  const config = stateConfig[state];

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* 状态指示灯 */}
      <div className="relative flex items-center justify-center">
        <span
          className={`
            w-2.5 h-2.5 rounded-full ${config.bgColor}
            ${config.pulse ? 'animate-pulse' : ''}
          `}
        />
        {config.pulse && (
          <span
            className={`
              absolute w-2.5 h-2.5 rounded-full ${config.bgColor}
              animate-ping opacity-75
            `}
          />
        )}
      </div>

      {/* 状态文字 */}
      <span className={`text-sm font-medium ${config.color}`}>
        {config.label}
      </span>

      {/* 详细信息 */}
      {showDetails && (
        <div className="ml-2 text-xs text-gray-500">
          {state === 'paired' && daemonId && (
            <span>Daemon: {daemonId.slice(0, 8)}...</span>
          )}
          {state === 'error' && error && (
            <span className="text-red-400">{error}</span>
          )}
        </div>
      )}
    </div>
  );
}
