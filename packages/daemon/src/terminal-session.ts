/**
 * 终端会话封装
 *
 * 使用 node-pty 启动 shell 进程，捕获完整终端输出
 */

import { EventEmitter } from 'events';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { SessionInfo, SessionStatus, TerminalSessionOptions } from '@mycc/shared';
import { createPtyEnv } from './pty-env.js';

// ============================================================================
// 类型定义
// ============================================================================

/** 终端会话事件 */
export interface TerminalSessionEvents {
  /** 输出数据（包含 ANSI 转义序列） */
  data: (data: string) => void;
  /** 会话退出 */
  exit: (code: number, signal?: number) => void;
  /** 状态变化 */
  statusChange: (status: SessionStatus) => void;
  /** 发生错误 */
  error: (error: Error) => void;
}

// ============================================================================
// 终端会话类
// ============================================================================

/**
 * 终端会话
 *
 * 特性：
 * - 使用 node-pty 启动 shell 进程（bash/zsh）
 * - 捕获完整终端输出（含 ANSI 转义序列）
 * - 支持发送任意输入
 * - 支持调整终端尺寸
 */
export class TerminalSession extends EventEmitter {
  /** 会话 ID */
  readonly id: string;
  /** PTY 实例 */
  private pty: IPty | null = null;
  /** 会话状态 */
  private _status: SessionStatus = 'starting';
  /** 创建时间 */
  private readonly createdAt: number;
  /** 会话配置 */
  private readonly options: TerminalSessionOptions;

  constructor(id: string, options: TerminalSessionOptions = {}) {
    super();
    this.id = id;
    this.options = options;
    this.createdAt = Date.now();
  }

  // --------------------------------------------------------------------------
  // 公共方法
  // --------------------------------------------------------------------------

  /**
   * 启动终端会话
   */
  async start(): Promise<void> {
    if (this.pty) {
      throw new Error('会话已启动');
    }

    try {
      const shell = this.options.shell ?? this.getDefaultShell();
      const cols = this.options.cols ?? 80;
      const rows = this.options.rows ?? 24;
      const cwd = this.options.cwd ?? process.cwd();

      this.pty = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: createPtyEnv(),
      });

      // 监听输出
      this.pty.onData((data: string) => {
        this.emit('data', data);
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
   * 发送输入到终端
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
   * 关闭终端会话
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
      type: 'terminal',
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
   * 获取当前终端尺寸
   */
  get size(): { cols: number; rows: number } {
    if (!this.pty) {
      return { cols: this.options.cols ?? 80, rows: this.options.rows ?? 24 };
    }
    return { cols: this.pty.cols, rows: this.pty.rows };
  }

  // --------------------------------------------------------------------------
  // 私有方法
  // --------------------------------------------------------------------------

  /**
   * 获取默认 shell
   */
  private getDefaultShell(): string {
    // 优先使用环境变量指定的 shell
    if (process.env['SHELL']) {
      return process.env['SHELL'];
    }

    // 根据平台选择默认 shell
    if (process.platform === 'win32') {
      return process.env['COMSPEC'] ?? 'cmd.exe';
    }

    return '/bin/bash';
  }

  /**
   * 获取会话标题
   */
  private getTitle(): string {
    if (this.pty) {
      return this.pty.process || 'Terminal';
    }
    return 'Terminal';
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
export declare interface TerminalSession {
  on<K extends keyof TerminalSessionEvents>(event: K, listener: TerminalSessionEvents[K]): this;
  emit<K extends keyof TerminalSessionEvents>(event: K, ...args: Parameters<TerminalSessionEvents[K]>): boolean;
  off<K extends keyof TerminalSessionEvents>(event: K, listener: TerminalSessionEvents[K]): this;
  once<K extends keyof TerminalSessionEvents>(event: K, listener: TerminalSessionEvents[K]): this;
}
