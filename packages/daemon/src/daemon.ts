/**
 * Daemon 主进程
 *
 * 后台常驻运行，维护与中继服务器的 WebSocket 连接，
 * 管理 SessionManager 实例，处理来自中继的消息并分发到对应会话
 */

import { EventEmitter } from 'events';
import type {
  TransportMessage,
  AppMessage,
  SessionCreateMessage,
  SessionCloseMessage,
  SessionInputMessage,
  SessionResizeMessage,
} from '@mytermux/shared';
import {
  createTransportMessage,
  generateMessageId,
  encryptJson,
  decryptJson,
} from '@mytermux/shared';
import { WsClient } from './ws-client.js';
import { SessionManager } from './session-manager.js';
import { AuthManager } from './auth-manager.js';

// ============================================================================
// 自定义错误类型
// ============================================================================

/** 密钥/加密相关错误（不代表客户端离线） */
class CryptoError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CryptoError';
    if (cause !== undefined) this.cause = cause;
  }
}

// ============================================================================
// 类型定义
// ============================================================================

/** Daemon 配置 */
export interface DaemonOptions {
  /** 中继服务器地址 */
  relayUrl: string;
}

/** Daemon 事件 */
export interface DaemonEvents {
  /** 启动完成 */
  started: () => void;
  /** 已停止 */
  stopped: () => void;
  /** 连接到中继服务器 */
  connected: () => void;
  /** 与中继服务器断开连接 */
  disconnected: () => void;
  /** 发生错误 */
  error: (error: Error) => void;
  /** Access Token 可用 */
  accessToken: (token: string) => void;
}

// ============================================================================
// Daemon 类
// ============================================================================

/**
 * Daemon 主进程
 *
 * 特性：
 * - 后台常驻运行
 * - 维护与中继服务器的 WebSocket 连接
 * - 管理 SessionManager 实例
 * - 处理来自中继的消息并分发到对应会话
 * - 支持 E2E 加密通信
 */
export class Daemon extends EventEmitter {
  /** 配置选项 */
  private readonly options: DaemonOptions;
  /** WebSocket 客户端 */
  private wsClient: WsClient | null = null;
  /** 会话管理器 */
  private readonly sessionManager: SessionManager;
  /** 认证管理器 */
  private readonly authManager: AuthManager;
  /** 运行状态 */
  private _isRunning = false;
  /** 当前在线的客户端 ID 集合（仅收到 token_ack 成功且未断线的） */
  private onlineClients = new Set<string>();

  constructor(options: DaemonOptions) {
    super();
    this.options = options;
    this.sessionManager = new SessionManager();
    this.authManager = new AuthManager();
  }

  // --------------------------------------------------------------------------
  // 公共方法
  // --------------------------------------------------------------------------

  /**
   * 启动 Daemon
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      throw new Error('Daemon 已在运行');
    }

    // 初始化认证管理器
    await this.authManager.initialize();

    // 创建 WebSocket 客户端
    // 确保 URL 包含 /ws 路径
    const wsUrl = this.options.relayUrl.endsWith('/ws')
      ? this.options.relayUrl
      : `${this.options.relayUrl.replace(/\/$/, '')}/ws`;

    this.wsClient = new WsClient({
      url: wsUrl,
      deviceType: 'daemon',
      deviceId: this.authManager.deviceId,
      publicKey: this.authManager.publicKey,
      accessToken: this.authManager.accessToken,
    });

    // 设置事件监听
    this.setupWsClientListeners();
    this.setupSessionManagerListeners();
    this.setupAuthManagerListeners();

    // 连接到中继服务器
    await this.wsClient.connect();

    this._isRunning = true;
    this.emit('started');
  }

  /**
   * 停止 Daemon
   */
  stop(): void {
    if (!this._isRunning) {
      return;
    }

    // 关闭所有会话
    this.sessionManager.closeAllSessions('Daemon stopping');

    // 清空在线客户端集合
    this.onlineClients.clear();

    // 断开 WebSocket 连接
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.wsClient = null;
    }

    this._isRunning = false;
    this.emit('stopped');
  }

  /**
   * 获取 Access Token
   * @returns Access Token
   */
  getAccessToken(): string {
    return this.authManager.accessToken;
  }

  /**
   * 重新生成 Access Token
   * @returns 新的 Access Token
   */
  async regenerateToken(): Promise<string> {
    return this.authManager.regenerateToken();
  }

  /**
   * 获取状态信息
   */
  getStatus(): {
    isRunning: boolean;
    isConnected: boolean;
    deviceId: string;
    sessionCount: number;
    authenticatedClientsCount: number;
    onlineClientsCount: number;
  } {
    return {
      isRunning: this._isRunning,
      isConnected: this.wsClient?.isConnected ?? false,
      deviceId: this.authManager.deviceId,
      sessionCount: this.sessionManager.sessionCount,
      authenticatedClientsCount: this.authManager.getAuthenticatedClients().length,
      onlineClientsCount: this.onlineClients.size,
    };
  }

  /**
   * 获取运行状态
   */
  get isRunning(): boolean {
    return this._isRunning;
  }

  // --------------------------------------------------------------------------
  // 私有方法 - 事件设置
  // --------------------------------------------------------------------------

  /**
   * 将未知错误转为 Error 对象
   */
  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  /**
   * 设置 WebSocket 客户端监听器
   */
  private setupWsClientListeners(): void {
    if (!this.wsClient) return;

    this.wsClient.on('connected', () => {
      this.emit('connected');
    });

    this.wsClient.on('disconnected', () => {
      // daemon 与 relay 断线，所有客户端视为离线
      this.onlineClients.clear();
      this.emit('disconnected');
    });

    this.wsClient.on('message', (message: TransportMessage) => {
      this.handleTransportMessage(message).catch((error: unknown) => {
        this.emit('error', this.toError(error));
      });
    });

    this.wsClient.on('error', (error: Error) => {
      this.emit('error', error);
    });

    this.wsClient.on('reconnecting', (attempt: number, delay: number) => {
      console.log(`正在重连... (第 ${attempt} 次尝试, ${delay}ms 后)`);
    });
  }

  /**
   * 设置会话管理器监听器
   */
  private setupSessionManagerListeners(): void {
    this.sessionManager.on('sessionOutput', (sessionId: string, data: string) => {
      this.broadcastSessionOutput(sessionId, data).catch((error: unknown) => {
        this.emit('error', this.toError(error));
      });
    });

    this.sessionManager.on('sessionClosed', (sessionId: string, reason?: string) => {
      this.broadcastSessionClosed(sessionId, reason).catch((error: unknown) => {
        this.emit('error', this.toError(error));
      });
    });

    this.sessionManager.on('error', (_sessionId: string, error: Error) => {
      this.emit('error', error);
    });
  }

  /**
   * 设置认证管理器监听器
   */
  private setupAuthManagerListeners(): void {
    this.authManager.on('clientAuthenticated', (client) => {
      console.log(`客户端认证成功: ${client.clientId}`);
    });

    this.authManager.on('tokenGenerated', (token) => {
      this.emit('accessToken', token);
    });
  }

  // --------------------------------------------------------------------------
  // 私有方法 - 消息处理
  // --------------------------------------------------------------------------

  /**
   * 处理传输层消息
   */
  private async handleTransportMessage(message: TransportMessage): Promise<void> {
    switch (message.type) {
      case 'register':
        // 忽略注册确认消息
        break;
      case 'token_ack':
        await this.handleTokenAckMessage(message);
        break;
      case 'message':
        await this.handleEncryptedMessage(message);
        break;
      case 'heartbeat':
        // 心跳消息，无需处理
        break;
      case 'error':
        this.handleErrorMessage(message);
        break;
      default:
        console.warn(`未知消息类型: ${message.type}`);
    }
  }

  /**
   * 处理令牌认证确认（客户端通过 Token 连接）
   */
  private async handleTokenAckMessage(message: TransportMessage): Promise<void> {
    try {
      const payload = JSON.parse(message.payload) as {
        success: boolean;
        clientId?: string;
        publicKey?: string;
        error?: string;
      };

      if (!payload.success) {
        // I6: 认证失败也 emit error 事件，让上层（如 CLI）能感知并报告
        const errorMsg = `客户端认证失败: ${payload.error ?? '未知错误'}`;
        console.warn(errorMsg);
        this.emit('error', new Error(errorMsg));
        return;
      }

      if (!payload.clientId || !payload.publicKey) {
        console.warn('认证确认消息缺少必要字段');
        return;
      }

      if (this.authManager.isAuthenticated(payload.clientId)) {
        // I2: 已认证的客户端重连，更新公钥
        // 安全说明：此消息由中继服务器在验证 Access Token 后转发。
        // 公钥更新的安全性依赖于以下信任链：
        // 1. 中继服务器验证了客户端持有的 Access Token
        // 2. Access Token 由 daemon 生成并仅通过可信渠道分发
        // 3. 中继服务器本身是可信的（与首次认证的信任假设一致）
        // 注意：如果中继服务器被攻陷，攻击者可伪造公钥实施 MITM
        console.log(`客户端重连，公钥更新: ${payload.clientId}`);
        await this.authManager.updateClientPublicKey(
          payload.clientId,
          payload.publicKey
        );
        console.log(`客户端重连成功: ${payload.clientId}`);
      } else {
        // 新客户端通过 Token 认证
        await this.authManager.completeAuthentication(
          payload.clientId,
          payload.publicKey
        );
        console.log(`新客户端认证成功: ${payload.clientId}`);
      }

      // 无论是重连还是新认证，都标记客户端为在线
      this.onlineClients.add(payload.clientId);
    } catch (error) {
      this.emit('error', this.toError(error));
    }
  }

  /**
   * 处理加密消息
   */
  private async handleEncryptedMessage(message: TransportMessage): Promise<void> {
    // 检查客户端是否已认证
    if (!this.authManager.isAuthenticated(message.from)) {
      console.warn(`收到未认证客户端的消息: ${message.from}`);
      return;
    }

    try {
      // 获取共享密钥
      const sharedKey = await this.authManager.getSharedKey(message.from);
      if (!sharedKey) {
        throw new Error('无法获取共享密钥');
      }

      // 解密消息
      const appMessage = await decryptJson<AppMessage>(sharedKey, message.payload);

      // 处理应用层消息
      await this.handleAppMessage(message.from, appMessage);
    } catch (error) {
      this.emit('error', this.toError(error));
    }
  }

  /**
   * 处理应用层消息
   */
  private async handleAppMessage(
    clientId: string,
    message: AppMessage
  ): Promise<void> {
    switch (message.action) {
      case 'session:create':
        await this.handleSessionCreate(clientId, message as SessionCreateMessage);
        break;
      case 'session:list':
        await this.handleSessionList(clientId, message);
        break;
      case 'session:close':
        await this.handleSessionClose(clientId, message as SessionCloseMessage);
        break;
      case 'session:input':
        this.handleSessionInput(message as SessionInputMessage);
        break;
      case 'session:resize':
        this.handleSessionResize(message as SessionResizeMessage);
        break;
      default:
        console.warn(`未知应用层消息动作: ${message.action}`);
    }
  }

  /**
   * 处理创建会话请求
   */
  private async handleSessionCreate(
    clientId: string,
    message: SessionCreateMessage
  ): Promise<void> {
    try {
      const session = await this.sessionManager.createSession(
        message.sessionType,
        message.options
      );

      await this.sendAppMessage(clientId, {
        action: 'session:created',
        messageId: generateMessageId(),
        session,
      });
    } catch (error) {
      await this.sendAppMessage(clientId, {
        action: 'error',
        messageId: generateMessageId(),
        code: 'SESSION_CREATE_FAILED',
        message: this.toError(error).message,
        relatedMessageId: message.messageId,
      });
    }
  }

  /**
   * 处理列出会话请求
   */
  private async handleSessionList(
    clientId: string,
    _message: AppMessage
  ): Promise<void> {
    const sessions = this.sessionManager.listSessions();

    await this.sendAppMessage(clientId, {
      action: 'session:list_response',
      messageId: generateMessageId(),
      sessions,
    });
  }

  /**
   * 处理关闭会话请求
   */
  private async handleSessionClose(
    clientId: string,
    message: SessionCloseMessage
  ): Promise<void> {
    this.sessionManager.closeSession(message.sessionId, 'Client requested');

    await this.sendAppMessage(clientId, {
      action: 'session:closed',
      messageId: generateMessageId(),
      sessionId: message.sessionId,
      reason: 'Client requested',
    });
  }

  /**
   * 处理会话输入
   */
  private handleSessionInput(message: SessionInputMessage): void {
    try {
      this.sessionManager.sendInput(message.sessionId, message.data);
    } catch (error) {
      this.emit('error', this.toError(error));
    }
  }

  /**
   * 处理会话尺寸调整
   */
  private handleSessionResize(message: SessionResizeMessage): void {
    try {
      this.sessionManager.resizeSession(
        message.sessionId,
        message.cols,
        message.rows
      );
    } catch (error) {
      this.emit('error', this.toError(error));
    }
  }

  /**
   * 处理错误消息
   */
  private handleErrorMessage(message: TransportMessage): void {
    try {
      const payload = JSON.parse(message.payload) as {
        code: string;
        message: string;
        /** PEER_DISCONNECTED 专用：断线设备的 ID */
        deviceId?: string;
      };

      // PEER_DISCONNECTED：客户端与 relay 断开，从在线集合中移除
      if (payload.code === 'PEER_DISCONNECTED') {
        // 优先使用结构化 deviceId 字段，兼容旧格式的正则解析
        const disconnectedId = payload.deviceId
          ?? payload.message.match(/:\s*(.+)$/)?.[1]?.trim();
        if (disconnectedId) {
          if (this.onlineClients.delete(disconnectedId)) {
            console.log(`客户端离线（PEER_DISCONNECTED）: ${disconnectedId}`);
          }
        } else {
          console.warn('[Daemon] PEER_DISCONNECTED 消息格式异常，无法解析 deviceId:', payload.message);
        }
        return;
      }

      // C5: 临时性错误也用 console.warn 记录，便于调试；不触发 error 事件以避免干扰正常流程
      if (payload.code === 'ROUTE_FAILED') {
        console.warn(`[Transient] [${payload.code}] ${payload.message}`);
        return;
      }

      this.emit('error', new Error(`[${payload.code}] ${payload.message}`));
    } catch (parseError) {
      this.emit('error', new Error(`处理错误消息失败: ${this.toError(parseError).message}`));
    }
  }

  // --------------------------------------------------------------------------
  // 私有方法 - 消息发送
  // --------------------------------------------------------------------------

  /**
   * 发送应用层消息
   *
   * @throws {CryptoError} 密钥获取/加密失败时抛出
   * @throws {Error} WebSocket 未连接或发送失败时抛出
   */
  private async sendAppMessage(
    clientId: string,
    message: Record<string, unknown>
  ): Promise<void> {
    if (!this.wsClient) {
      throw new Error('WebSocket 未连接');
    }

    try {
      const sharedKey = await this.authManager.getSharedKey(clientId);
      if (!sharedKey) {
        throw new Error('无法获取共享密钥');
      }

      const encryptedPayload = await encryptJson(sharedKey, message);

      const transportMessage = createTransportMessage(
        'message',
        this.authManager.deviceId,
        encryptedPayload,
        clientId
      );

      this.wsClient.sendMessage(transportMessage);
    } catch (error) {
      // wsClient.sendMessage 抛出的 'WebSocket 未连接' 是网络错误，直接透传
      if (error instanceof CryptoError) throw error;
      const msg = this.toError(error).message;
      // 密钥获取失败和加密失败包装为 CryptoError，其他错误（网络/发送）透传
      if (msg === '无法获取共享密钥' || msg.includes('密钥对未初始化')) {
        throw new CryptoError(msg, error);
      }
      // encryptJson 等加密操作的异常也包装为 CryptoError
      // 唯一的非加密异常来源是 wsClient.sendMessage（'WebSocket 未连接'）
      if (msg !== 'WebSocket 未连接') {
        throw new CryptoError(msg, error);
      }
      throw error;
    }
  }

  /**
   * 广播会话输出到所有在线客户端
   */
  private async broadcastSessionOutput(
    sessionId: string,
    data: string
  ): Promise<void> {
    const message = {
      action: 'session:output' as const,
      messageId: generateMessageId(),
      sessionId,
      data,
    };

    await this.broadcastToAllClients(message);
  }

  /**
   * 广播会话关闭通知
   */
  private async broadcastSessionClosed(
    sessionId: string,
    reason?: string
  ): Promise<void> {
    const message = {
      action: 'session:closed' as const,
      messageId: generateMessageId(),
      sessionId,
      ...(reason !== undefined && { reason }),
    };

    await this.broadcastToAllClients(message);
  }

  /**
   * 广播消息到所有在线客户端
   *
   * 仅向 onlineClients 集合中的客户端发送，跳过历史认证但已离线的客户端。
   * 通过 CryptoError 类型区分密钥/加密错误（仅记录，不移除）和网络错误（标记离线），
   * 使用快照迭代避免在遍历 Set 时修改其内容。
   */
  private async broadcastToAllClients(
    message: Record<string, unknown>
  ): Promise<void> {
    const failedClients: string[] = [];

    // 使用数组快照迭代，避免在遍历 Set 时修改
    for (const clientId of [...this.onlineClients]) {
      try {
        await this.sendAppMessage(clientId, message);
      } catch (error) {
        if (error instanceof CryptoError) {
          // 密钥/加密错误不代表客户端离线，仅记录日志
          console.error(`发送消息到客户端 ${clientId} 加密失败（不移除）:`, error.message);
        } else {
          // 网络/发送类错误，标记为离线
          console.error(`发送消息到客户端 ${clientId} 失败，标记为离线:`, this.toError(error).message);
          failedClients.push(clientId);
        }
      }
    }

    // 批量移除失败客户端
    for (const clientId of failedClients) {
      this.onlineClients.delete(clientId);
    }
  }
}

// ============================================================================
// 类型增强
// ============================================================================

// 为 EventEmitter 添加类型支持
export declare interface Daemon {
  on<K extends keyof DaemonEvents>(event: K, listener: DaemonEvents[K]): this;
  emit<K extends keyof DaemonEvents>(event: K, ...args: Parameters<DaemonEvents[K]>): boolean;
  off<K extends keyof DaemonEvents>(event: K, listener: DaemonEvents[K]): this;
  once<K extends keyof DaemonEvents>(event: K, listener: DaemonEvents[K]): this;
}
