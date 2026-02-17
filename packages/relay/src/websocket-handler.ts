/**
 * WebSocket 处理器模块
 *
 * 功能：
 * - 处理 WebSocket 连接生命周期
 * - 解析传输层消息
 * - 调用 DeviceRegistry 和 MessageRouter
 */

import type { WebSocket, RawData } from 'ws';
import type { TransportMessage, DeviceType } from '@opentermux/shared';
import { isTransportMessage, createTransportMessage } from '@opentermux/shared';
import type { DeviceRegistry } from './device-registry';
import type { MessageRouter } from './message-router';
import type { WsTicketPayload, WsTicketService } from './auth/ws-ticket.js';

/** 注册消息载荷 */
interface RegisterPayload {
  deviceType: DeviceType;
  publicKey: string;
  /** daemon 注册时携带的 Access Token */
  accessToken?: string;
}

/** Token 认证消息载荷 */
interface TokenAuthPayload {
  deviceType: DeviceType;
  publicKey: string;
  /** Access Token（用于客户端认证连接 daemon） */
  accessToken?: string;
}

/** WebSocket 连接上下文 */
interface ConnectionContext {
  ticket: string | null;
  clientTicketValidated: boolean;
  ticketPayload: WsTicketPayload | null;
}

/**
 * WebSocket 连接处理器
 */
export class WebSocketHandler {
  private deviceRegistry: DeviceRegistry;
  private messageRouter: MessageRouter;
  private wsTicketService: WsTicketService;

  /** WebSocket → deviceId 反向映射（用于连接关闭时查找） */
  private wsToDeviceId: Map<WebSocket, string> = new Map();
  /** WebSocket 连接上下文（ticket / 校验状态） */
  private wsContexts: Map<WebSocket, ConnectionContext> = new Map();

  constructor(deviceRegistry: DeviceRegistry, messageRouter: MessageRouter, wsTicketService: WsTicketService) {
    this.deviceRegistry = deviceRegistry;
    this.messageRouter = messageRouter;
    this.wsTicketService = wsTicketService;
  }

  /**
   * 处理新的 WebSocket 连接
   *
   * @param ws WebSocket 连接
   */
  handleConnection(ws: WebSocket, requestUrl?: string): void {
    console.log('[WebSocketHandler] 新连接建立');
    const ticket = this.extractTicketFromRequestUrl(requestUrl);
    this.wsContexts.set(ws, {
      ticket,
      clientTicketValidated: false,
      ticketPayload: null,
    });

    // 设置消息处理
    ws.on('message', (data: RawData) => {
      this.handleMessage(ws, data);
    });

    // 设置连接关闭处理
    ws.on('close', (code: number, reason: Buffer) => {
      this.handleClose(ws, code, reason.toString());
    });

    // 设置错误处理
    ws.on('error', (error: Error) => {
      this.handleError(ws, error);
    });
  }

  /**
   * 处理接收到的消息
   *
   * @param ws WebSocket 连接
   * @param data 原始消息数据
   */
  private handleMessage(ws: WebSocket, data: RawData): void {
    let message: unknown;

    try {
      message = JSON.parse(data.toString());
    } catch (parseErr) {
      console.error('[WebSocketHandler] 消息解析失败:', parseErr);
      this.sendError(ws, 'INVALID_JSON', '无效的 JSON 格式');
      return;
    }

    // 验证传输层消息格式
    if (!isTransportMessage(message)) {
      console.error('[WebSocketHandler] 非法消息格式');
      this.sendError(ws, 'INVALID_MESSAGE', '消息格式不正确');
      return;
    }

    // 根据消息类型分发处理
    switch (message.type) {
      case 'register':
        this.handleRegister(ws, message);
        break;
      case 'token_auth':
        this.handleTokenAuth(ws, message);
        break;
      case 'heartbeat':
        this.handleHeartbeat(ws, message);
        break;
      case 'message':
        this.handleRoutedMessage(ws, message);
        break;
      default:
        console.warn(`[WebSocketHandler] 未知消息类型: ${message.type}`);
        this.sendError(ws, 'UNKNOWN_TYPE', `未知消息类型: ${message.type}`);
    }
  }

  /**
   * 处理设备注册
   * daemon 注册时可携带 accessToken
   *
   * @param ws WebSocket 连接
   * @param message 注册消息
   */
  private handleRegister(ws: WebSocket, message: TransportMessage): void {
    let payload: RegisterPayload;

    try {
      payload = JSON.parse(message.payload) as RegisterPayload;
    } catch (parseErr) {
      console.error('[WebSocketHandler] 注册消息载荷解析失败:', parseErr);
      this.sendError(ws, 'INVALID_PAYLOAD', '注册消息载荷格式错误');
      return;
    }

    if (!payload.deviceType || !['daemon', 'client'].includes(payload.deviceType)) {
      this.sendError(ws, 'INVALID_DEVICE_TYPE', '无效的设备类型');
      return;
    }

    // Web client 必须通过 ws-ticket 准入
    if (payload.deviceType === 'client' && !this.ensureClientTicket(ws)) {
      return;
    }

    const deviceId = message.from;

    // 检查是否已有连接使用相同 WebSocket
    const existingDeviceId = this.wsToDeviceId.get(ws);
    if (existingDeviceId && existingDeviceId !== deviceId) {
      console.warn(`[WebSocketHandler] WebSocket 重复注册: ${existingDeviceId} -> ${deviceId}`);
      this.deviceRegistry.unregisterDevice(existingDeviceId);
    }

    // 如果同一 deviceId 已被另一个 ws 注册（重连场景），清理旧 ws 的映射
    this.cleanupOldWsMapping(deviceId, ws);

    // 注册设备（包含公钥和可选的 accessToken）
    this.deviceRegistry.registerDevice(
      ws,
      deviceId,
      payload.deviceType,
      payload.publicKey,
      payload.accessToken
    );
    this.wsToDeviceId.set(ws, deviceId);

    // 发送注册成功确认
    const ackPayload = JSON.stringify({ success: true, deviceId });
    const ack = createTransportMessage('register', 'relay', ackPayload, deviceId);
    ws.send(JSON.stringify(ack));

    console.log(`[WebSocketHandler] 设备注册成功: ${deviceId} (${payload.deviceType})`);
  }

  /**
   * 处理 Token 认证（客户端使用 Access Token 连接 daemon）
   *
   * @param ws WebSocket 连接
   * @param message Token 认证消息
   */
  private handleTokenAuth(ws: WebSocket, message: TransportMessage): void {
    let payload: TokenAuthPayload;

    try {
      payload = JSON.parse(message.payload) as TokenAuthPayload;
    } catch (parseErr) {
      console.error('[WebSocketHandler] Token 认证消息载荷解析失败:', parseErr);
      this.sendError(ws, 'INVALID_PAYLOAD', 'Token 认证消息载荷格式错误');
      // I9: payload 解析失败意味着客户端发送了无效数据，关闭连接避免资源占用
      ws.close(4000, 'Token 认证消息载荷格式错误');
      return;
    }

    // 校验 deviceType：token_auth 仅限 client 使用
    if (payload.deviceType !== 'client') {
      this.sendError(ws, 'INVALID_DEVICE_TYPE', 'Token 认证仅限客户端使用');
      return;
    }

    // client token_auth 必须通过 ws-ticket 准入
    if (!this.ensureClientTicket(ws)) {
      return;
    }

    const clientId = message.from;

    // 检查是否已有连接使用相同 WebSocket
    const existingDeviceId = this.wsToDeviceId.get(ws);
    if (existingDeviceId && existingDeviceId !== clientId) {
      console.warn(`[WebSocketHandler] WebSocket 重复注册: ${existingDeviceId} -> ${clientId}`);
      this.deviceRegistry.unregisterDevice(existingDeviceId);
    }

    // 如果同一 clientId 已被另一个 ws 注册（重连场景），清理旧 ws 的映射
    this.cleanupOldWsMapping(clientId, ws);

    // 先注册客户端设备
    this.deviceRegistry.registerDevice(ws, clientId, payload.deviceType, payload.publicKey);
    this.wsToDeviceId.set(ws, clientId);

    // 使用 Access Token 验证并建立认证关系
    const context = this.wsContexts.get(ws);
    const accessToken = payload.accessToken ?? context?.ticketPayload?.accessToken;

    if (!accessToken) {
      this.sendError(ws, 'TOKEN_REQUIRED', '缺少 Access Token');
      this.deviceRegistry.unregisterDevice(clientId);
      this.wsToDeviceId.delete(ws);
      ws.close(4002, '缺少 Access Token');
      return;
    }

    const daemonId = this.deviceRegistry.validateAccessToken(accessToken, clientId);

    if (daemonId) {
      // 获取 daemon 的公钥
      const daemonPublicKey = this.deviceRegistry.getPublicKey(daemonId);

      // 发送认证成功响应给 client
      const clientAckPayload = JSON.stringify({
        success: true,
        daemonId,
        publicKey: daemonPublicKey,
      });
      const clientAck = createTransportMessage('token_ack', 'relay', clientAckPayload, clientId);
      ws.send(JSON.stringify(clientAck));

      // 通知 daemon 客户端已认证
      const daemonPayload = JSON.stringify({
        success: true,
        clientId,
        publicKey: payload.publicKey,
      });
      this.messageRouter.sendSystemMessage(daemonId, 'token_ack', daemonPayload);

      console.log(`[WebSocketHandler] Token 认证成功: ${clientId} <-> ${daemonId}`);
    } else {
      // Token 认证失败，清理已注册但未认证的设备
      this.deviceRegistry.unregisterDevice(clientId);
      this.wsToDeviceId.delete(ws);

      const ackPayload = JSON.stringify({
        success: false,
        error: 'Access Token 无效或 Daemon 未连接',
      });
      const ack = createTransportMessage('token_ack', 'relay', ackPayload, clientId);
      ws.send(JSON.stringify(ack));

      // 认证失败后关闭连接，避免未认证的 WebSocket 持续占用资源
      ws.close(4001, 'Token 认证失败');

      console.log(`[WebSocketHandler] Token 认证失败: ${clientId}`);
    }
  }

  /**
   * 处理心跳消息
   *
   * @param _ws WebSocket 连接（未使用）
   * @param message 心跳消息
   */
  private handleHeartbeat(_ws: WebSocket, message: TransportMessage): void {
    const deviceId = message.from;

    // 更新心跳时间
    this.deviceRegistry.updateHeartbeat(deviceId);

    // 回复心跳
    this.messageRouter.sendHeartbeatAck(deviceId);
  }

  /**
   * 处理需要路由的消息
   *
   * @param ws WebSocket 连接
   * @param message 传输层消息
   */
  private handleRoutedMessage(ws: WebSocket, message: TransportMessage): void {
    const from = message.from;
    const to = message.to;

    if (!to) {
      // 如果没有指定目标，尝试发送给已认证对端
      const result = this.messageRouter.broadcastToPaired(from, message.payload);
      if (!result.success) {
        this.sendError(ws, 'ROUTE_FAILED', result.error || '消息路由失败');
      }
      return;
    }

    // 路由到指定设备
    const result = this.messageRouter.routeMessage(from, to, message.payload);
    if (!result.success) {
      this.sendError(ws, 'ROUTE_FAILED', result.error || '消息路由失败');
    }
  }

  /**
   * 处理连接关闭
   *
   * @param ws WebSocket 连接
   * @param code 关闭代码
   * @param reason 关闭原因
   */
  private handleClose(ws: WebSocket, code: number, reason: string): void {
    const deviceId = this.wsToDeviceId.get(ws);

    if (deviceId) {
      console.log(`[WebSocketHandler] 连接关闭: ${deviceId} (code: ${code}, reason: ${reason})`);

      // 检查当前注册的 ws 是否和正在关闭的 ws 相同。
      // 如果不同，说明该 deviceId 已被新连接替换（重连场景），
      // 旧 ws 的 close 事件不应注销新连接的注册信息。
      const currentWs = this.deviceRegistry.getWebSocket(deviceId);
      if (currentWs === ws) {
        // 通知已认证对端设备
        this.messageRouter.notifyPeerDisconnected(deviceId);

        // 注销设备
        this.deviceRegistry.unregisterDevice(deviceId);
      } else {
        // 该 deviceId 已被新 ws 替换（重连场景），旧 ws 关闭不影响新注册
        console.log(`[WebSocketHandler] 旧连接关闭，设备已被新连接替换: ${deviceId}`);
      }

      this.wsToDeviceId.delete(ws);
      this.wsContexts.delete(ws);
    } else {
      console.log(`[WebSocketHandler] 未注册连接关闭 (code: ${code})`);
      this.wsContexts.delete(ws);
    }
  }

  /**
   * 处理连接错误
   *
   * @param ws WebSocket 连接
   * @param error 错误对象
   */
  private handleError(ws: WebSocket, error: Error): void {
    const deviceId = this.wsToDeviceId.get(ws) ?? 'unknown';
    console.error(`[WebSocketHandler] 连接错误: ${deviceId}`, error.message);
    this.wsContexts.delete(ws);
  }

  /**
   * 清理旧 WebSocket 的映射
   *
   * 当同一 deviceId 使用新 ws 重连时，旧 ws 可能仍在 wsToDeviceId 中。
   * 如果不清理，旧 ws 的 close 事件会误注销新连接的注册信息。
   *
   * @param deviceId 设备 ID
   * @param newWs 新的 WebSocket 连接
   */
  private cleanupOldWsMapping(deviceId: string, newWs: WebSocket): void {
    const currentWs = this.deviceRegistry.getWebSocket(deviceId);
    if (currentWs && currentWs !== newWs) {
      console.log(`[WebSocketHandler] 清理旧连接映射: ${deviceId}`);
      this.wsToDeviceId.delete(currentWs);
      currentWs.close(4000, '被新连接替换');
    }
  }

  /**
   * 校验 client ws-ticket
   */
  private ensureClientTicket(ws: WebSocket): boolean {
    const context = this.wsContexts.get(ws);
    if (!context) {
      this.sendError(ws, 'WS_CONTEXT_NOT_FOUND', '连接上下文不存在');
      ws.close(4003, '连接上下文不存在');
      return false;
    }

    if (context.clientTicketValidated) {
      return true;
    }

    if (!context.ticket) {
      this.sendError(ws, 'WS_TICKET_REQUIRED', '缺少 ws ticket');
      ws.close(4003, '缺少 ws ticket');
      return false;
    }

    const consumed = this.wsTicketService.consume(context.ticket);
    if (!consumed) {
      this.sendError(ws, 'WS_TICKET_INVALID', 'ws ticket 无效或已过期');
      ws.close(4003, 'ws ticket 无效或已过期');
      return false;
    }

    context.clientTicketValidated = true;
    context.ticketPayload = consumed;
    return true;
  }

  /**
   * 从升级 URL 中提取 ws ticket
   */
  private extractTicketFromRequestUrl(requestUrl?: string): string | null {
    if (!requestUrl) {
      return null;
    }

    try {
      const parsed = new URL(requestUrl, 'http://relay.local');
      return parsed.searchParams.get('ticket');
    } catch {
      return null;
    }
  }

  /**
   * 发送错误消息
   *
   * @param ws WebSocket 连接
   * @param code 错误码
   * @param errorMessage 错误描述
   */
  private sendError(ws: WebSocket, code: string, errorMessage: string): void {
    if (ws.readyState !== 1) {
      return;
    }

    const payload = JSON.stringify({ code, message: errorMessage });
    const message = createTransportMessage('error', 'relay', payload);

    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      console.error('[WebSocketHandler] 发送错误消息失败:', err);
    }
  }

  /**
   * 获取连接统计信息
   */
  getStats(): { activeConnections: number } {
    return {
      activeConnections: this.wsToDeviceId.size,
    };
  }
}
