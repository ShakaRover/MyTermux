/**
 * Claude 会话封装
 *
 * 使用 node-pty 启动 claude 子进程，捕获输出并检测权限提示
 */

import { EventEmitter } from 'events';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type {
  SessionInfo,
  SessionStatus,
  ClaudeSessionOptions,
  PermissionRequest,
} from '@mycc/shared';
import { randomUUID } from 'crypto';
import { createPtyEnv } from './pty-env.js';

// ============================================================================
// 类型定义
// ============================================================================

/** Claude 会话事件 */
export interface ClaudeSessionEvents {
  /** 输出数据（包含 ANSI 转义序列） */
  data: (data: string) => void;
  /** 会话退出 */
  exit: (code: number, signal?: number) => void;
  /** 状态变化 */
  statusChange: (status: SessionStatus) => void;
  /** 权限请求 */
  permissionRequest: (request: PermissionRequest) => void;
  /** 发生错误 */
  error: (error: Error) => void;
}

// ============================================================================
// 权限检测正则表达式
// ============================================================================

/** 权限提示匹配模式 */
const PERMISSION_PATTERNS = [
  // 标准权限提示
  /Allow\s+([^\?]+)\?\s*\[(Y)es\/(n)o\]/i,
  // 工具使用提示
  /Do you want to allow\s+([^\?]+)\?/i,
  // 危险操作确认
  /This will\s+([^.]+)\.\s*Continue\?/i,
];

// ============================================================================
// Claude 会话类
// ============================================================================

/**
 * Claude 会话
 *
 * 特性：
 * - 使用 node-pty 启动 claude 子进程
 * - 捕获终端输出流（保留 ANSI 格式）
 * - 检测权限提示并触发事件
 * - 支持指定项目路径、模型参数
 */
export class ClaudeSession extends EventEmitter {
  /** 会话 ID */
  readonly id: string;
  /** PTY 实例 */
  private pty: IPty | null = null;
  /** 会话状态 */
  private _status: SessionStatus = 'starting';
  /** 创建时间 */
  private readonly createdAt: number;
  /** 会话配置 */
  private readonly options: ClaudeSessionOptions;
  /** 输出缓冲区（用于检测权限提示） */
  private outputBuffer = '';
  /** 完整输出历史（用于客户端重连时回放） */
  private _outputHistory = '';
  /** 输出历史最大长度（256KB） */
  private static readonly MAX_OUTPUT_HISTORY = 256 * 1024;
  /** 当前待处理的权限请求 */
  private pendingPermission: PermissionRequest | null = null;

  constructor(id: string, options: ClaudeSessionOptions = {}) {
    super();
    this.id = id;
    this.options = options;
    this.createdAt = Date.now();
  }

  // --------------------------------------------------------------------------
  // 公共方法
  // --------------------------------------------------------------------------

  /**
   * 启动 Claude 会话
   */
  async start(): Promise<void> {
    if (this.pty) {
      throw new Error('会话已启动');
    }

    try {
      // 构建 claude 命令参数
      const args: string[] = [];

      if (this.options.model) {
        args.push('--model', this.options.model);
      }

      // 如果有初始提示词，添加到参数
      if (this.options.initialPrompt) {
        args.push('--print', this.options.initialPrompt);
      }

      const cwd = this.options.cwd ?? process.cwd();

      this.pty = pty.spawn('claude', args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd,
        env: createPtyEnv(),
      });

      // 监听输出
      this.pty.onData((data: string) => {
        this.handleOutput(data);
      });

      // 监听退出
      this.pty.onExit(({ exitCode, signal }) => {
        this.setStatus('stopped');
        this.emit('exit', exitCode, signal);
        this.pty = null;
      });

      this.setStatus('running');
    } catch (error) {
      this.setStatus('error');
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * 发送输入到 Claude
   * @param data 输入数据
   */
  sendInput(data: string): void {
    if (!this.pty) {
      throw new Error('会话未启动或已结束');
    }

    this.pty.write(data);
  }

  /**
   * 调整终端尺寸
   * @param cols 列数
   * @param rows 行数
   */
  resize(cols: number, rows: number): void {
    if (!this.pty) {
      throw new Error('会话未启动或已结束');
    }

    this.pty.resize(cols, rows);
  }

  /**
   * 批准当前权限请求
   */
  approvePermission(): void {
    if (!this.pendingPermission) {
      throw new Error('没有待处理的权限请求');
    }

    this.sendInput('y\n');
    this.pendingPermission = null;
  }

  /**
   * 拒绝当前权限请求
   */
  rejectPermission(): void {
    if (!this.pendingPermission) {
      throw new Error('没有待处理的权限请求');
    }

    this.sendInput('n\n');
    this.pendingPermission = null;
  }

  /**
   * 关闭会话
   */
  close(): void {
    if (this.pty) {
      this.pty.kill();
      this.pty = null;
    }
    this.setStatus('stopped');
  }

  /**
   * 获取会话信息
   */
  getInfo(): SessionInfo {
    return {
      id: this.id,
      type: 'claude',
      status: this._status,
      createdAt: this.createdAt,
      title: this.getTitle(),
    };
  }

  /**
   * 获取当前状态
   */
  get status(): SessionStatus {
    return this._status;
  }

  /**
   * 获取完整输出历史（供客户端重连时回放）
   */
  get outputHistory(): string {
    return this._outputHistory;
  }

  // --------------------------------------------------------------------------
  // 私有方法
  // --------------------------------------------------------------------------

  /**
   * 处理输出数据
   */
  private handleOutput(data: string): void {
    // 发送原始输出
    this.emit('data', data);

    // 追加到完整输出历史（供客户端重连时回放）
    this._outputHistory += data;
    if (this._outputHistory.length > ClaudeSession.MAX_OUTPUT_HISTORY) {
      this._outputHistory = this._outputHistory.slice(-ClaudeSession.MAX_OUTPUT_HISTORY);
    }

    // 更新缓冲区并检测权限提示
    this.outputBuffer += data;

    // 限制缓冲区大小（保留最后 2000 字符）
    if (this.outputBuffer.length > 2000) {
      this.outputBuffer = this.outputBuffer.slice(-2000);
    }

    // 检测权限提示
    this.detectPermissionRequest();
  }

  /**
   * 检测权限请求
   */
  private detectPermissionRequest(): void {
    if (this.pendingPermission) {
      // 已有待处理的请求，跳过检测
      return;
    }

    for (const pattern of PERMISSION_PATTERNS) {
      const match = pattern.exec(this.outputBuffer);
      if (match) {
        const description = match[1]?.trim() ?? 'Unknown operation';

        const request: PermissionRequest = {
          id: randomUUID(),
          sessionId: this.id,
          tool: 'claude',
          description,
          status: 'pending',
          requestedAt: Date.now(),
        };

        this.pendingPermission = request;
        this.outputBuffer = ''; // 清空缓冲区
        this.emit('permissionRequest', request);
        break;
      }
    }
  }

  /**
   * 获取会话标题
   */
  private getTitle(): string {
    const prefix = 'Claude';
    if (this.options.cwd) {
      const parts = this.options.cwd.split('/');
      return `${prefix}: ${parts[parts.length - 1]}`;
    }
    return prefix;
  }

  /**
   * 设置状态并触发事件
   */
  private setStatus(status: SessionStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit('statusChange', status);
    }
  }
}

// ============================================================================
// 类型增强
// ============================================================================

// 为 EventEmitter 添加类型支持
export declare interface ClaudeSession {
  on<K extends keyof ClaudeSessionEvents>(event: K, listener: ClaudeSessionEvents[K]): this;
  emit<K extends keyof ClaudeSessionEvents>(event: K, ...args: Parameters<ClaudeSessionEvents[K]>): boolean;
  off<K extends keyof ClaudeSessionEvents>(event: K, listener: ClaudeSessionEvents[K]): this;
  once<K extends keyof ClaudeSessionEvents>(event: K, listener: ClaudeSessionEvents[K]): this;
}
