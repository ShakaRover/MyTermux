/**
 * 公共类型定义
 */

// ============================================================================
// 会话类型
// ============================================================================

/** 会话类型枚举 */
export type SessionType = 'terminal';

/** 会话状态枚举 */
export type SessionStatus = 'starting' | 'running' | 'stopped' | 'error';

/** 会话基础信息 */
export interface SessionInfo {
  /** 会话唯一标识 */
  id: string;
  /** 会话类型 */
  type: SessionType;
  /** 会话状态 */
  status: SessionStatus;
  /** 终端进程 PID（可选，某些平台/实现可能不可用） */
  pid?: number;
  /** 创建时间戳 */
  createdAt: number;
  /** 会话标题/名称 */
  title: string;
  /** 输出历史（客户端重连时回放，仅在 session:list_response 中携带） */
  outputHistory?: string;
}

/** 终端会话配置 */
export interface TerminalSessionOptions {
  /** 工作目录 */
  cwd?: string;
  /** Shell 类型 */
  shell?: string;
  /** 会话启动后自动执行的命令（会自动追加回车） */
  startupCommand?: string;
  /** 终端列数 */
  cols?: number;
  /** 终端行数 */
  rows?: number;
}

/** 会话创建选项 */
export type SessionOptions = TerminalSessionOptions;

// ============================================================================
// 设备类型
// ============================================================================

/** 设备类型枚举 */
export type DeviceType = 'daemon' | 'client';

/** 设备信息 */
export interface DeviceInfo {
  /** 设备唯一标识 */
  id: string;
  /** 设备类型 */
  type: DeviceType;
  /** 设备名称 */
  name?: string;
  /** 连接时间戳 */
  connectedAt: number;
}

// ============================================================================
// 认证相关
// ============================================================================

/** 认证状态 */
export type AuthStatus = 'pending' | 'authenticated' | 'failed';

// ============================================================================
// Web 管理相关
// ============================================================================

/** daemon 默认命令模式 */
export type DefaultCommandMode = 'zsh' | 'bash' | 'tmux' | 'custom';

/** daemon 配置（Web 管理中心） */
export interface DaemonProfile {
  /** 配置 ID */
  id: string;
  /** 显示名称 */
  name: string;
  /** 绑定的 daemonId（可选） */
  daemonId?: string | null;
  /** 掩码后的 token（仅展示） */
  accessTokenMasked?: string | null;
  /** 是否已配置 token */
  hasToken: boolean;
  /** 默认工作目录 */
  defaultCwd?: string | null;
  /** 默认命令模式 */
  defaultCommandMode: DefaultCommandMode;
  /** 默认命令值（custom 模式使用） */
  defaultCommandValue?: string | null;
  /** 当前是否在线（由 API 聚合） */
  online?: boolean;
  /** 最后心跳时间戳（在线时可用） */
  lastHeartbeat?: number;
  /** 已连接客户端数量 */
  connectedClients?: number;
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
}

/** 在线 daemon 快照 */
export interface OnlineDaemon {
  daemonId: string;
  lastHeartbeat: number;
  connectedAt: number;
  connectedClients: number;
}

/** Web 终端快捷键 */
export interface WebShortcut {
  /** 快捷键唯一 ID */
  id: string;
  /** 展示文本 */
  label: string;
  /** 发送到终端的数据 */
  value: string;
}

/** Web 端偏好设置 */
export interface WebPreferences {
  shortcuts: WebShortcut[];
  commonChars: string[];
  updatedAt: number;
}
