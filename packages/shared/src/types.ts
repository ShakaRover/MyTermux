/**
 * 公共类型定义
 */

// ============================================================================
// 会话类型
// ============================================================================

/** 会话类型枚举 */
export type SessionType = 'claude' | 'terminal';

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
  /** 创建时间戳 */
  createdAt: number;
  /** 会话标题/名称 */
  title: string;
}

/** Claude 会话配置 */
export interface ClaudeSessionOptions {
  /** 工作目录 */
  cwd?: string;
  /** 模型选择 */
  model?: string;
  /** 初始提示词 */
  initialPrompt?: string;
}

/** 终端会话配置 */
export interface TerminalSessionOptions {
  /** 工作目录 */
  cwd?: string;
  /** Shell 类型 */
  shell?: string;
  /** 终端列数 */
  cols?: number;
  /** 终端行数 */
  rows?: number;
}

/** 会话创建选项 */
export type SessionOptions = ClaudeSessionOptions | TerminalSessionOptions;

// ============================================================================
// 权限请求类型
// ============================================================================

/** 权限请求状态 */
export type PermissionStatus = 'pending' | 'approved' | 'rejected';

/** 权限请求信息 */
export interface PermissionRequest {
  /** 请求唯一标识 */
  id: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 工具名称 */
  tool: string;
  /** 工具描述 */
  description: string;
  /** 请求状态 */
  status: PermissionStatus;
  /** 请求时间戳 */
  requestedAt: number;
}

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
// 配对相关
// ============================================================================

/** 配对状态 */
export type PairingStatus = 'pending' | 'completed' | 'expired' | 'failed';

/** 配对信息 */
export interface PairingInfo {
  /** 配对码 (6位数字) */
  code: string;
  /** 过期时间戳 */
  expiresAt: number;
  /** 配对状态 */
  status: PairingStatus;
}
