/**
 * WebSocket 客户端
 *
 * 负责与中继服务器保持持久连接，支持自动重连（指数退避）
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type {
  TransportMessage,
  TransportMessageType,
  DeviceType,
} from '@mycc/shared';
import { createTransportMessage } from '@mycc/shared';

// ============================================================================
// 类型定义
// ============================================================================

/** WebSocket 客户端配置 */
export interface WsClientOptions {
  /** 中继服务器地址 */
  url: string;
  /** 设备类型 */
  deviceType: DeviceType;
  /** 设备 ID */
  deviceId: string;
  /** 公钥（Base64 编码） */
  publicKey: string;
  /** Access Token（daemon 注册时携带） */
  accessToken?: string;
  /** 初始重连延迟（毫秒） */
  initialReconnectDelay?: number;
  /** 最大重连延迟（毫秒） */
  maxReconnectDelay?: number;
  /** 心跳间隔（毫秒） */
  heartbeatInterval?: number;
}

/** WebSocket 客户端事件 */
export interface WsClientEvents {
  /** 连接成功 */
  connected: () => void;
  /** 连接断开 */
  disconnected: (code: number, reason: string) => void;
  /** 收到消息 */
  message: (message: TransportMessage) => void;
  /** 发生错误 */
  error: (error: Error) => void;
  /** 重连中 */
  reconnecting: (attempt: number, delay: number) => void;
}

// ============================================================================
// WebSocket 客户端类
// ============================================================================

/**
 * WebSocket 客户端
 *
 * 特性：
 * - 自动重连（指数退避算法）
 * - 心跳保活
 * - 事件驱动
 */
export class WsClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly options: Required<Omit<WsClientOptions, 'accessToken'>> & Pick<WsClientOptions, 'accessToken'>;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isConnecting = false;
  private shouldReconnect = true;

  constructor(options: WsClientOptions) {
    super();
    this.options = {
      initialReconnectDelay: 1000,
      maxReconnectDelay: 30000,
      heartbeatInterval: 30000,
      ...options,
    };
  }

  // --------------------------------------------------------------------------
  // 公共方法
  // --------------------------------------------------------------------------

  /**
   * 连接到中继服务器
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.options.url);

        this.ws.on('open', () => {
          this.isConnecting = false;
          this.reconnectAttempt = 0;
          this.registerDevice();
          this.startHeartbeat();
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data: WebSocket.RawData) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          this.handleClose(code, reason.toString());
        });

        this.ws.on('error', (error: Error) => {
          this.isConnecting = false;
          this.emit('error', error);
          // 如果是初次连接失败，reject Promise
          if (this.reconnectAttempt === 0) {
            reject(error);
          }
        });
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }
  }

  /**
   * 发送传输层消息
   * @param type 消息类型
   * @param payload 消息载荷
   * @param to 目标设备 ID（可选）
   */
  send(type: TransportMessageType, payload: string, to?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接');
    }

    const message = createTransportMessage(
      type,
      this.options.deviceId,
      payload,
      to
    );

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 发送原始传输层消息对象
   * @param message 完整的传输层消息
   */
  sendMessage(message: TransportMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接');
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 检查连接状态
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * 获取设备 ID
   */
  get deviceId(): string {
    return this.options.deviceId;
  }

  // --------------------------------------------------------------------------
  // 私有方法
  // --------------------------------------------------------------------------

  /**
   * 注册设备
   */
  private registerDevice(): void {
    const payload: Record<string, string> = {
      deviceType: this.options.deviceType,
      publicKey: this.options.publicKey,
    };

    if (this.options.accessToken) {
      payload.accessToken = this.options.accessToken;
    }

    this.send('register', JSON.stringify(payload));
  }

  /**
   * 处理收到的消息
   */
  private handleMessage(data: WebSocket.RawData): void {
    try {
      const message = JSON.parse(data.toString()) as TransportMessage;
      this.emit('message', message);
    } catch (error) {
      this.emit('error', new Error(`消息解析失败: ${String(error)}`));
    }
  }

  /**
   * 处理连接关闭
   */
  private handleClose(code: number, reason: string): void {
    this.stopHeartbeat();
    this.emit('disconnected', code, reason);

    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * 调度重连
   */
  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    const delay = Math.min(
      this.options.initialReconnectDelay * Math.pow(2, this.reconnectAttempt),
      this.options.maxReconnectDelay
    );

    this.reconnectAttempt++;
    this.emit('reconnecting', this.reconnectAttempt, delay);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error: unknown) => {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      });
    }, delay);
  }

  /**
   * 清除重连定时器
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send('heartbeat', '');
      }
    }, this.options.heartbeatInterval);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// ============================================================================
// 类型增强
// ============================================================================

// 为 EventEmitter 添加类型支持
export declare interface WsClient {
  on<K extends keyof WsClientEvents>(event: K, listener: WsClientEvents[K]): this;
  emit<K extends keyof WsClientEvents>(event: K, ...args: Parameters<WsClientEvents[K]>): boolean;
  off<K extends keyof WsClientEvents>(event: K, listener: WsClientEvents[K]): this;
  once<K extends keyof WsClientEvents>(event: K, listener: WsClientEvents[K]): this;
}
