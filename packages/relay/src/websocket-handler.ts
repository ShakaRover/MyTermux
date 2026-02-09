/**
 * WebSocket 处理器模块
 *
 * 功能：
 * - 处理 WebSocket 连接生命周期
 * - 解析传输层消息
 * - 调用 DeviceRegistry 和 MessageRouter
 */

import type { WebSocket, RawData } from 'ws';
import type { TransportMessage, DeviceType } from '@mycc/shared';
import { isTransportMessage, createTransportMessage } from '@mycc/shared';
import type { DeviceRegistry } from './device-registry';
import type { MessageRouter } from './message-router';

/** 注册消息载荷 */
interface RegisterPayload {
  deviceType: DeviceType;
  publicKey: string;
}

/** 配对码注册消息载荷 */
interface PairingCodePayload {
  code: string;
  expiresAt: number;
}

/** 配对消息载荷 */
interface PairPayload {
  code: string;
  publicKey: string;
}

/**
 * WebSocket 连接处理器
 */
export class WebSocketHandler {
  private deviceRegistry: DeviceRegistry;
  private messageRouter: MessageRouter;

  /** WebSocket → deviceId 反向映射（用于连接关闭时查找） */
  private wsToDeviceId: Map<WebSocket, string> = new Map();

  constructor(deviceRegistry: DeviceRegistry, messageRouter: MessageRouter) {
    this.deviceRegistry = deviceRegistry;
    this.messageRouter = messageRouter;
  }

  /**
   * 处理新的 WebSocket 连接
   *
   * @param ws WebSocket 连接
   */
  handleConnection(ws: WebSocket): void {
    console.log('[WebSocketHandler] 新连接建立');

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
    } catch {
      console.error('[WebSocketHandler] 消息解析失败');
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
      case 'pairing_code':
        this.handlePairingCode(ws, message);
        break;
      case 'pair':
        this.handlePair(ws, message);
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
   *
   * @param ws WebSocket 连接
   * @param message 注册消息
   */
  private handleRegister(ws: WebSocket, message: TransportMessage): void {
    let payload: RegisterPayload;

    try {
      payload = JSON.parse(message.payload) as RegisterPayload;
    } catch {
      this.sendError(ws, 'INVALID_PAYLOAD', '注册消息载荷格式错误');
      return;
    }

    if (!payload.deviceType || !['daemon', 'client'].includes(payload.deviceType)) {
      this.sendError(ws, 'INVALID_DEVICE_TYPE', '无效的设备类型');
      return;
    }

    const deviceId = message.from;

    // 检查是否已有连接使用相同 WebSocket
    const existingDeviceId = this.wsToDeviceId.get(ws);
    if (existingDeviceId && existingDeviceId !== deviceId) {
      console.warn(`[WebSocketHandler] WebSocket 重复注册: ${existingDeviceId} -> ${deviceId}`);
      this.deviceRegistry.unregisterDevice(existingDeviceId);
    }

    // 注册设备（包含公钥）
    this.deviceRegistry.registerDevice(ws, deviceId, payload.deviceType, payload.publicKey);
    this.wsToDeviceId.set(ws, deviceId);

    // 发送注册成功确认
    const ackPayload = JSON.stringify({ success: true, deviceId });
    const ack = createTransportMessage('register', 'relay', ackPayload, deviceId);
    ws.send(JSON.stringify(ack));

    console.log(`[WebSocketHandler] 设备注册成功: ${deviceId} (${payload.deviceType})`);
  }

  /**
   * 处理配对码注册（daemon → relay）
   *
   * @param ws WebSocket 连接
   * @param message 配对码消息
   */
  private handlePairingCode(ws: WebSocket, message: TransportMessage): void {
    let payload: PairingCodePayload;

    try {
      payload = JSON.parse(message.payload) as PairingCodePayload;
    } catch {
      this.sendError(ws, 'INVALID_PAYLOAD', '配对码消息载荷格式错误');
      return;
    }

    const daemonId = message.from;

    // 验证 daemon 是否已注册
    const device = this.deviceRegistry.getDevice(daemonId);
    if (!device || device.deviceType !== 'daemon') {
      this.sendError(ws, 'NOT_DAEMON', '只有 daemon 可以注册配对码');
      return;
    }

    // 注册配对码
    try {
      this.deviceRegistry.registerPairingCode(
        daemonId,
        payload.code,
        payload.expiresAt
      );

      // 发送确认
      const ackPayload = JSON.stringify({ success: true, code: payload.code });
      const ack = createTransportMessage('pairing_code', 'relay', ackPayload, daemonId);
      ws.send(JSON.stringify(ack));

      console.log(`[WebSocketHandler] 配对码已注册: ${payload.code} (daemon: ${daemonId})`);
    } catch (error) {
      this.sendError(
        ws,
        'PAIRING_CODE_FAILED',
        error instanceof Error ? error.message : '配对码注册失败'
      );
    }
  }

  /**
   * 处理配对请求
   *
   * @param ws WebSocket 连接
   * @param message 配对消息
   */
  private handlePair(ws: WebSocket, message: TransportMessage): void {
    let payload: PairPayload;

    try {
      payload = JSON.parse(message.payload) as PairPayload;
    } catch {
      this.sendError(ws, 'INVALID_PAYLOAD', '配对消息载荷格式错误');
      return;
    }

    const clientId = message.from;

    // 验证配对码并完成配对
    const daemonId = this.deviceRegistry.validatePairingCode(payload.code, clientId);

    if (daemonId) {
      // 获取 daemon 的公钥
      const daemonPublicKey = this.deviceRegistry.getPublicKey(daemonId);

      // 配对成功，通知 client（包含 daemon 公钥）
      this.messageRouter.sendPairAck(clientId, true, daemonId, daemonPublicKey);

      // 通知 daemon 配对成功（包含 client 公钥）
      const daemonPayload = JSON.stringify({
        success: true,
        clientId,
        publicKey: payload.publicKey,
      });
      this.messageRouter.sendSystemMessage(daemonId, 'pair_ack', daemonPayload);

      console.log(`[WebSocketHandler] 配对成功: ${clientId} <-> ${daemonId}`);
    } else {
      // 配对失败
      this.messageRouter.sendPairAck(clientId, false, undefined, undefined, '配对码无效或已过期');
      console.log(`[WebSocketHandler] 配对失败: ${clientId}`);
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
      // 如果没有指定目标，尝试发送给配对设备
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

      // 通知配对设备
      this.messageRouter.notifyPeerDisconnected(deviceId);

      // 注销设备
      this.deviceRegistry.unregisterDevice(deviceId);
      this.wsToDeviceId.delete(ws);
    } else {
      console.log(`[WebSocketHandler] 未注册连接关闭 (code: ${code})`);
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
