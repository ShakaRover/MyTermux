/**
 * 会话管理器
 *
 * 统一管理所有 Claude 和 Terminal 会话
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type {
  SessionType,
  SessionInfo,
  SessionOptions,
  ClaudeSessionOptions,
  TerminalSessionOptions,
  PermissionRequest,
} from '@mycc/shared';
import { ClaudeSession } from './claude-session.js';
import { TerminalSession } from './terminal-session.js';

// ============================================================================
// 类型定义
// ============================================================================

/** 会话联合类型 */
export type Session = ClaudeSession | TerminalSession;

/** 会话管理器事件 */
export interface SessionManagerEvents {
  /** 会话创建 */
  sessionCreated: (session: SessionInfo) => void;
  /** 会话关闭 */
  sessionClosed: (sessionId: string, reason?: string) => void;
  /** 会话输出 */
  sessionOutput: (sessionId: string, data: string) => void;
  /** 权限请求 */
  permissionRequest: (request: PermissionRequest) => void;
  /** 发生错误 */
  error: (sessionId: string, error: Error) => void;
}

// ============================================================================
// 会话管理器类
// ============================================================================

/**
 * 会话管理器
 *
 * 特性：
 * - 统一管理所有 Claude + Terminal 会话
 * - 支持创建、列出、关闭会话
 * - 监听会话输出事件并向上传递
 */
export class SessionManager extends EventEmitter {
  /** 会话存储 */
  private readonly sessions = new Map<string, Session>();

  constructor() {
    super();
  }

  // --------------------------------------------------------------------------
  // 公共方法
  // --------------------------------------------------------------------------

  /**
   * 创建会话
   * @param type 会话类型
   * @param options 会话选项
   * @returns 会话信息
   */
  async createSession(
    type: SessionType,
    options?: SessionOptions
  ): Promise<SessionInfo> {
    const id = randomUUID();

    let session: Session;

    if (type === 'claude') {
      session = new ClaudeSession(id, options as ClaudeSessionOptions);
      this.setupClaudeSessionListeners(session);
    } else {
      session = new TerminalSession(id, options as TerminalSessionOptions);
      this.setupTerminalSessionListeners(session);
    }

    this.sessions.set(id, session);

    try {
      await session.start();
      const info = session.getInfo();
      this.emit('sessionCreated', info);
      return info;
    } catch (error) {
      this.sessions.delete(id);
      throw error;
    }
  }

  /**
   * 列出所有活跃会话
   * @returns 会话信息列表
   */
  listSessions(): SessionInfo[] {
    const sessions: SessionInfo[] = [];
    for (const session of this.sessions.values()) {
      sessions.push(session.getInfo());
    }
    return sessions;
  }

  /**
   * 获取指定会话
   * @param id 会话 ID
   * @returns 会话实例（如果存在）
   */
  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /**
   * 关闭指定会话
   * @param id 会话 ID
   * @param reason 关闭原因
   */
  closeSession(id: string, reason?: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }

    session.close();
    this.sessions.delete(id);
    this.emit('sessionClosed', id, reason);
  }

  /**
   * 关闭所有会话
   * @param reason 关闭原因
   */
  closeAllSessions(reason?: string): void {
    for (const id of this.sessions.keys()) {
      this.closeSession(id, reason);
    }
  }

  /**
   * 向会话发送输入
   * @param id 会话 ID
   * @param data 输入数据
   */
  sendInput(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`会话不存在: ${id}`);
    }

    session.sendInput(data);
  }

  /**
   * 调整会话终端尺寸
   * @param id 会话 ID
   * @param cols 列数
   * @param rows 行数
   */
  resizeSession(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`会话不存在: ${id}`);
    }

    session.resize(cols, rows);
  }

  /**
   * 响应权限请求
   * @param sessionId 会话 ID
   * @param approved 是否批准
   */
  respondToPermission(sessionId: string, approved: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session || !(session instanceof ClaudeSession)) {
      throw new Error(`Claude 会话不存在: ${sessionId}`);
    }

    if (approved) {
      session.approvePermission();
    } else {
      session.rejectPermission();
    }
  }

  /**
   * 获取会话数量
   */
  get sessionCount(): number {
    return this.sessions.size;
  }

  // --------------------------------------------------------------------------
  // 私有方法
  // --------------------------------------------------------------------------

  /**
   * 设置 Claude 会话监听器
   */
  private setupClaudeSessionListeners(session: ClaudeSession): void {
    session.on('data', (data: string) => {
      this.emit('sessionOutput', session.id, data);
    });

    session.on('permissionRequest', (request: PermissionRequest) => {
      this.emit('permissionRequest', request);
    });

    session.on('exit', (_code: number) => {
      this.sessions.delete(session.id);
      this.emit('sessionClosed', session.id, 'Session exited');
    });

    session.on('error', (error: Error) => {
      this.emit('error', session.id, error);
    });
  }

  /**
   * 设置终端会话监听器
   */
  private setupTerminalSessionListeners(session: TerminalSession): void {
    session.on('data', (data: string) => {
      this.emit('sessionOutput', session.id, data);
    });

    session.on('exit', (_code: number) => {
      this.sessions.delete(session.id);
      this.emit('sessionClosed', session.id, 'Session exited');
    });

    session.on('error', (error: Error) => {
      this.emit('error', session.id, error);
    });
  }
}

// ============================================================================
// 类型增强
// ============================================================================

// 为 EventEmitter 添加类型支持
export declare interface SessionManager {
  on<K extends keyof SessionManagerEvents>(event: K, listener: SessionManagerEvents[K]): this;
  emit<K extends keyof SessionManagerEvents>(event: K, ...args: Parameters<SessionManagerEvents[K]>): boolean;
  off<K extends keyof SessionManagerEvents>(event: K, listener: SessionManagerEvents[K]): this;
  once<K extends keyof SessionManagerEvents>(event: K, listener: SessionManagerEvents[K]): this;
}
