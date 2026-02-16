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
