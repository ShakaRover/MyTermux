/**
 * 消息协议定义
 *
 * 分为两层：
 * - 传输层：中继服务器可见，用于路由
 * - 应用层：E2E 加密，中继服务器无法解密
 */

import type {
  SessionType,
  SessionInfo,
  SessionOptions,
  PermissionRequest,
} from './types.js';

// ============================================================================
// 传输层协议（中继可见）
// ============================================================================

/** 传输层消息类型 */
export type TransportMessageType =
  | 'register'    // 设备注册
  | 'pair'        // 配对请求
  | 'pair_ack'    // 配对确认
  | 'message'     // 加密消息
  | 'heartbeat'   // 心跳
  | 'error';      // 错误

/** 传输层消息基础结构 */
export interface TransportMessage {
  /** 消息类型 */
  type: TransportMessageType;
  /** 发送者设备 ID */
  from: string;
  /** 接收者设备 ID（可选，广播时为空） */
  to?: string;
  /** 消息载荷（加密后的应用层消息或明文控制消息） */
  payload: string;
  /** 消息时间戳 */
  timestamp: number;
}

/** 设备注册消息 */
export interface RegisterMessage extends TransportMessage {
  type: 'register';
  payload: string; // JSON: { deviceType: DeviceType, publicKey: string }
}

/** 配对请求消息 */
export interface PairMessage extends TransportMessage {
  type: 'pair';
  payload: string; // JSON: { code: string, publicKey: string }
}

/** 配对确认消息 */
export interface PairAckMessage extends TransportMessage {
  type: 'pair_ack';
  payload: string; // JSON: { success: boolean, daemonId?: string, publicKey?: string, error?: string }
}

/** 心跳消息 */
export interface HeartbeatMessage extends TransportMessage {
  type: 'heartbeat';
  payload: ''; // 空载荷
}

/** 错误消息 */
export interface ErrorMessage extends TransportMessage {
  type: 'error';
  payload: string; // JSON: { code: string, message: string }
}

// ============================================================================
// 应用层协议（E2E 加密）
// ============================================================================

/** 应用层消息动作类型 */
export type AppMessageAction =
  // 会话管理
  | 'session:create'
  | 'session:created'
  | 'session:list'
  | 'session:list_response'
  | 'session:close'
  | 'session:closed'
  // 会话交互
  | 'session:input'
  | 'session:output'
  | 'session:resize'
  // 权限审批
  | 'permission:request'
  | 'permission:respond'
  // 错误
  | 'error';

/** 应用层消息基础结构 */
export interface AppMessage {
  /** 消息动作 */
  action: AppMessageAction;
  /** 消息 ID（用于请求-响应匹配） */
  messageId?: string;
}

// ----------------------------------------------------------------------------
// 会话管理消息
// ----------------------------------------------------------------------------

/** 创建会话请求 */
export interface SessionCreateMessage extends AppMessage {
  action: 'session:create';
  /** 会话类型 */
  sessionType: SessionType;
  /** 会话选项 */
  options?: SessionOptions;
}

/** 会话创建响应 */
export interface SessionCreatedMessage extends AppMessage {
  action: 'session:created';
  /** 新创建的会话信息 */
  session: SessionInfo;
}

/** 列出会话请求 */
export interface SessionListMessage extends AppMessage {
  action: 'session:list';
}

/** 会话列表响应 */
export interface SessionListResponseMessage extends AppMessage {
  action: 'session:list_response';
  /** 会话列表 */
  sessions: SessionInfo[];
}

/** 关闭会话请求 */
export interface SessionCloseMessage extends AppMessage {
  action: 'session:close';
  /** 会话 ID */
  sessionId: string;
}

/** 会话关闭通知 */
export interface SessionClosedMessage extends AppMessage {
  action: 'session:closed';
  /** 会话 ID */
  sessionId: string;
  /** 关闭原因 */
  reason?: string;
}

// ----------------------------------------------------------------------------
// 会话交互消息
// ----------------------------------------------------------------------------

/** 会话输入消息 */
export interface SessionInputMessage extends AppMessage {
  action: 'session:input';
  /** 会话 ID */
  sessionId: string;
  /** 输入数据 */
  data: string;
}

/** 会话输出消息 */
export interface SessionOutputMessage extends AppMessage {
  action: 'session:output';
  /** 会话 ID */
  sessionId: string;
  /** 输出数据（可能包含 ANSI 转义序列） */
  data: string;
}

/** 终端尺寸调整消息 */
export interface SessionResizeMessage extends AppMessage {
  action: 'session:resize';
  /** 会话 ID */
  sessionId: string;
  /** 列数 */
  cols: number;
  /** 行数 */
  rows: number;
}

// ----------------------------------------------------------------------------
// 权限审批消息
// ----------------------------------------------------------------------------

/** 权限请求消息（daemon → client） */
export interface PermissionRequestMessage extends AppMessage {
  action: 'permission:request';
  /** 权限请求详情 */
  request: PermissionRequest;
}

/** 权限响应消息（client → daemon） */
export interface PermissionRespondMessage extends AppMessage {
  action: 'permission:respond';
  /** 会话 ID */
  sessionId: string;
  /** 请求 ID */
  requestId: string;
  /** 是否批准 */
  approved: boolean;
}

// ----------------------------------------------------------------------------
// 错误消息
// ----------------------------------------------------------------------------

/** 应用层错误消息 */
export interface AppErrorMessage extends AppMessage {
  action: 'error';
  /** 错误码 */
  code: string;
  /** 错误描述 */
  message: string;
  /** 关联的消息 ID（如果是响应错误） */
  relatedMessageId?: string;
}

// ============================================================================
// 类型守卫
// ============================================================================

/** 有效的传输层消息类型 */
const VALID_TRANSPORT_TYPES = new Set<string>([
  'register', 'pair', 'pair_ack', 'message', 'heartbeat', 'error'
]);

/** 有效的应用层消息动作 */
const VALID_APP_ACTIONS = new Set<string>([
  'session:create', 'session:created', 'session:list', 'session:list_response',
  'session:close', 'session:closed', 'session:input', 'session:output',
  'session:resize', 'permission:request', 'permission:respond', 'error'
]);

/** 检查是否为传输层消息 */
export function isTransportMessage(msg: unknown): msg is TransportMessage {
  if (typeof msg !== 'object' || msg === null) {
    return false;
  }
  const obj = msg as Record<string, unknown>;
  return (
    typeof obj['type'] === 'string' &&
    VALID_TRANSPORT_TYPES.has(obj['type']) &&
    typeof obj['from'] === 'string' &&
    typeof obj['timestamp'] === 'number' &&
    typeof obj['payload'] === 'string'
  );
}

/** 检查是否为应用层消息 */
export function isAppMessage(msg: unknown): msg is AppMessage {
  if (typeof msg !== 'object' || msg === null) {
    return false;
  }
  const obj = msg as Record<string, unknown>;
  return (
    typeof obj['action'] === 'string' &&
    VALID_APP_ACTIONS.has(obj['action'])
  );
}

// ============================================================================
// 辅助函数
// ============================================================================

/** 创建传输层消息 */
export function createTransportMessage(
  type: TransportMessageType,
  from: string,
  payload: string,
  to?: string
): TransportMessage {
  const message: TransportMessage = {
    type,
    from,
    payload,
    timestamp: Date.now(),
  };
  if (to !== undefined) {
    message.to = to;
  }
  return message;
}

/** 生成消息 ID */
export function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
