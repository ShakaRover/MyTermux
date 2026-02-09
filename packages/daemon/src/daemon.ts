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
  PermissionRespondMessage,
  PermissionRequest,
  // SessionListMessage 未使用因为 handleSessionList 不需要消息参数
} from '@mycc/shared';
import {
  createTransportMessage,
  generateMessageId,
  encryptJson,
  decryptJson,
} from '@mycc/shared';
import { WsClient } from './ws-client.js';
import { SessionManager } from './session-manager.js';
import { PairingManager } from './pairing.js';

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
  /** 配对码已生成 */
  pairingCode: (code: string, expiresAt: number) => void;
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
  /** 配对管理器 */
  private readonly pairingManager: PairingManager;
  /** 运行状态 */
  private _isRunning = false;

  constructor(options: DaemonOptions) {
    super();
    this.options = options;
    this.sessionManager = new SessionManager();
    this.pairingManager = new PairingManager();
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

    // 初始化配对管理器
    await this.pairingManager.initialize();

    // 创建 WebSocket 客户端
    this.wsClient = new WsClient({
      url: this.options.relayUrl,
      deviceType: 'daemon',
      deviceId: this.pairingManager.deviceId,
      publicKey: this.pairingManager.publicKey,
    });

    // 设置事件监听
    this.setupWsClientListeners();
    this.setupSessionManagerListeners();
    this.setupPairingManagerListeners();

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

    // 断开 WebSocket 连接
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.wsClient = null;
    }

    this._isRunning = false;
    this.emit('stopped');
  }

  /**
   * 生成新的配对码
   * @returns 配对码和过期时间
   */
  generatePairingCode(): { code: string; expiresAt: number } {
    const info = this.pairingManager.generateNewPairingCode();
    return { code: info.code, expiresAt: info.expiresAt };
  }

  /**
   * 获取状态信息
   */
  getStatus(): {
    isRunning: boolean;
    isConnected: boolean;
    deviceId: string;
    sessionCount: number;
    pairedClientsCount: number;
  } {
    return {
      isRunning: this._isRunning,
      isConnected: this.wsClient?.isConnected ?? false,
      deviceId: this.pairingManager.deviceId,
      sessionCount: this.sessionManager.sessionCount,
      pairedClientsCount: this.pairingManager.getPairedClients().length,
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
   * 设置 WebSocket 客户端监听器
   */
  private setupWsClientListeners(): void {
    if (!this.wsClient) return;

    this.wsClient.on('connected', () => {
      this.emit('connected');
    });

    this.wsClient.on('disconnected', () => {
      this.emit('disconnected');
    });

    this.wsClient.on('message', (message: TransportMessage) => {
      this.handleTransportMessage(message).catch((error: unknown) => {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
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
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      });
    });

    this.sessionManager.on('sessionClosed', (sessionId: string, reason?: string) => {
      this.broadcastSessionClosed(sessionId, reason).catch((error: unknown) => {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      });
    });

    this.sessionManager.on('permissionRequest', (request) => {
      this.broadcastPermissionRequest(request).catch((error: unknown) => {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      });
    });

    this.sessionManager.on('error', (_sessionId: string, error: Error) => {
      this.emit('error', error);
    });
  }

  /**
   * 设置配对管理器监听器
   */
  private setupPairingManagerListeners(): void {
    this.pairingManager.on('pairingCodeGenerated', (info) => {
      this.emit('pairingCode', info.code, info.expiresAt);
    });

    this.pairingManager.on('pairingSuccess', (client) => {
      console.log(`配对成功: ${client.clientId}`);
    });

    this.pairingManager.on('pairingExpired', () => {
      console.log('配对码已过期');
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
      case 'pair':
        await this.handlePairMessage(message);
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
   * 处理配对请求
   */
  private async handlePairMessage(message: TransportMessage): Promise<void> {
    if (!this.wsClient) return;

    try {
      const payload = JSON.parse(message.payload) as {
        code: string;
        publicKey: string;
        name?: string;
      };

      // 验证配对码
      if (!this.pairingManager.validatePairingCode(payload.code)) {
        // 发送配对失败响应
        const response = createTransportMessage(
          'pair_ack',
          this.pairingManager.deviceId,
          JSON.stringify({ success: false, error: '配对码无效或已过期' }),
          message.from
        );
        this.wsClient.sendMessage(response);
        return;
      }

      // 完成配对
      await this.pairingManager.completePairing(
        message.from,
        payload.publicKey,
        payload.name
      );

      // 发送配对成功响应
      const response = createTransportMessage(
        'pair_ack',
        this.pairingManager.deviceId,
        JSON.stringify({
          success: true,
          daemonId: this.pairingManager.deviceId,
          publicKey: this.pairingManager.publicKey,
        }),
        message.from
      );
      this.wsClient.sendMessage(response);
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 处理加密消息
   */
  private async handleEncryptedMessage(message: TransportMessage): Promise<void> {
    // 检查是否已配对
    if (!this.pairingManager.isPaired(message.from)) {
      console.warn(`收到未配对客户端的消息: ${message.from}`);
      return;
    }

    try {
      // 获取共享密钥
      const sharedKey = await this.pairingManager.getSharedKey(message.from);
      if (!sharedKey) {
        throw new Error('无法获取共享密钥');
      }

      // 解密消息
      const appMessage = await decryptJson<AppMessage>(sharedKey, message.payload);

      // 处理应用层消息
      await this.handleAppMessage(message.from, appMessage);
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
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
      case 'permission:respond':
        this.handlePermissionRespond(message as PermissionRespondMessage);
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
        message: error instanceof Error ? error.message : String(error),
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
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
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
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 处理权限响应
   */
  private handlePermissionRespond(message: PermissionRespondMessage): void {
    try {
      this.sessionManager.respondToPermission(
        message.sessionId,
        message.approved
      );
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
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
      };
      this.emit('error', new Error(`[${payload.code}] ${payload.message}`));
    } catch {
      this.emit('error', new Error(`收到错误消息: ${message.payload}`));
    }
  }

  // --------------------------------------------------------------------------
  // 私有方法 - 消息发送
  // --------------------------------------------------------------------------

  /**
   * 发送应用层消息
   */
  private async sendAppMessage(
    clientId: string,
    message: Record<string, unknown>
  ): Promise<void> {
    if (!this.wsClient) return;

    const sharedKey = await this.pairingManager.getSharedKey(clientId);
    if (!sharedKey) {
      throw new Error('无法获取共享密钥');
    }

    const encryptedPayload = await encryptJson(sharedKey, message);

    const transportMessage = createTransportMessage(
      'message',
      this.pairingManager.deviceId,
      encryptedPayload,
      clientId
    );

    this.wsClient.sendMessage(transportMessage);
  }

  /**
   * 广播会话输出到所有已配对客户端
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
    const message: Record<string, unknown> = {
      action: 'session:closed',
      messageId: generateMessageId(),
      sessionId,
    };

    if (reason !== undefined) {
      message['reason'] = reason;
    }

    await this.broadcastToAllClients(message);
  }

  /**
   * 广播权限请求
   */
  private async broadcastPermissionRequest(
    request: PermissionRequest
  ): Promise<void> {
    const message = {
      action: 'permission:request' as const,
      messageId: generateMessageId(),
      request,
    };

    await this.broadcastToAllClients(message);
  }

  /**
   * 广播消息到所有已配对客户端
   */
  private async broadcastToAllClients(
    message: Record<string, unknown>
  ): Promise<void> {
    const clients = this.pairingManager.getPairedClients();

    for (const client of clients) {
      try {
        await this.sendAppMessage(client.clientId, message);
      } catch (error) {
        // 单个客户端发送失败不影响其他客户端
        console.error(`发送消息到客户端 ${client.clientId} 失败:`, error);
      }
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
