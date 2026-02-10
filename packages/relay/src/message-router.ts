/**
 * 消息路由模块
 *
 * 功能：
 * - 在已配对设备之间路由消息
 * - 只转发加密消息，不解密
 * - 验证消息来源和目标
 */

import type { TransportMessage } from '@mycc/shared';
import { createTransportMessage } from '@mycc/shared';
import type { DeviceRegistry } from './device-registry';

/** 路由结果 */
export interface RouteResult {
  /** 是否成功 */
  success: boolean;
  /** 错误信息（失败时） */
  error?: string;
}

/**
 * 消息路由器
 */
export class MessageRouter {
  private deviceRegistry: DeviceRegistry;

  constructor(deviceRegistry: DeviceRegistry) {
    this.deviceRegistry = deviceRegistry;
  }

  /**
   * 路由消息到目标设备
   *
   * @param from 发送者设备 ID
   * @param to 接收者设备 ID
   * @param payload 消息载荷（加密后的数据）
   * @returns 路由结果
   */
  routeMessage(from: string, to: string, payload: string): RouteResult {
    // 验证发送者是否存在
    const fromDevice = this.deviceRegistry.getDevice(from);
    if (!fromDevice) {
      console.log(`[MessageRouter] 发送者不存在: ${from}`);
      return { success: false, error: '发送者设备未注册' };
    }

    // 验证接收者是否存在
    const toDevice = this.deviceRegistry.getDevice(to);
    if (!toDevice) {
      console.log(`[MessageRouter] 接收者不存在: ${to}`);
      return { success: false, error: '接收者设备未连接' };
    }

    // 验证配对关系
    if (!this.deviceRegistry.arePaired(from, to)) {
      console.log(`[MessageRouter] 设备未配对: ${from} <-> ${to}`);
      return { success: false, error: '设备未配对' };
    }

    // 构造传输层消息
    const message = createTransportMessage('message', from, payload, to);

    // 发送消息
    const sendResult = this.sendToDevice(to, message);
    if (!sendResult.success) {
      return sendResult;
    }

    console.log(`[MessageRouter] 消息已路由: ${from} -> ${to}`);
    return { success: true };
  }

  /**
   * 广播消息到所有配对设备
   *
   * @param from 发送者设备 ID
   * @param payload 消息载荷
   * @returns 路由结果
   */
  broadcastToPaired(from: string, payload: string): RouteResult {
    const pairedDeviceIds = this.deviceRegistry.getPairedDeviceIds(from);

    if (!pairedDeviceIds || pairedDeviceIds.size === 0) {
      console.log(`[MessageRouter] 设备未配对，无法广播: ${from}`);
      return { success: false, error: '设备未配对' };
    }

    let lastError: string | undefined;
    let anySuccess = false;

    for (const pairedId of pairedDeviceIds) {
      const result = this.routeMessage(from, pairedId, payload);
      if (result.success) {
        anySuccess = true;
      } else {
        lastError = result.error;
      }
    }

    if (!anySuccess && lastError) {
      return { success: false, error: lastError };
    }

    return { success: true };
  }

  /**
   * 发送系统消息到指定设备
   *
   * @param to 接收者设备 ID
   * @param type 消息类型
   * @param payload 消息载荷
   * @returns 路由结果
   */
  sendSystemMessage(
    to: string,
    type: TransportMessage['type'],
    payload: string
  ): RouteResult {
    const toDevice = this.deviceRegistry.getDevice(to);
    if (!toDevice) {
      return { success: false, error: '接收者设备未连接' };
    }

    // 系统消息来源为 'relay'
    const message = createTransportMessage(type, 'relay', payload, to);
    return this.sendToDevice(to, message);
  }

  /**
   * 发送错误消息到指定设备
   *
   * @param to 接收者设备 ID
   * @param code 错误码
   * @param errorMessage 错误描述
   * @returns 路由结果
   */
  sendError(to: string, code: string, errorMessage: string): RouteResult {
    const payload = JSON.stringify({ code, message: errorMessage });
    return this.sendSystemMessage(to, 'error', payload);
  }

  /**
   * 发送心跳响应
   *
   * @param to 接收者设备 ID
   * @returns 路由结果
   */
  sendHeartbeatAck(to: string): RouteResult {
    return this.sendSystemMessage(to, 'heartbeat', '');
  }

  /**
   * 直接发送传输层消息到设备
   *
   * @param deviceId 目标设备 ID
   * @param message 传输层消息
   * @returns 发送结果
   */
  private sendToDevice(deviceId: string, message: TransportMessage): RouteResult {
    const ws = this.deviceRegistry.getWebSocket(deviceId);

    if (!ws) {
      return { success: false, error: '设备 WebSocket 连接不存在' };
    }

    if (ws.readyState !== 1) {
      // WebSocket.OPEN = 1
      return { success: false, error: '设备 WebSocket 连接未就绪' };
    }

    try {
      ws.send(JSON.stringify(message));
      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '发送失败';
      console.error(`[MessageRouter] 发送消息失败: ${deviceId}`, err);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 通知配对设备对方已断开
   *
   * @param disconnectedDeviceId 断开连接的设备 ID
   */
  notifyPeerDisconnected(disconnectedDeviceId: string): void {
    const pairedDeviceIds = this.deviceRegistry.getPairedDeviceIds(disconnectedDeviceId);
    if (pairedDeviceIds) {
      for (const pairedId of pairedDeviceIds) {
        // 使用结构化 payload 传递 disconnectedDeviceId，避免接收方依赖正则解析
        const payload = JSON.stringify({
          code: 'PEER_DISCONNECTED',
          message: `配对设备已断开连接: ${disconnectedDeviceId}`,
          deviceId: disconnectedDeviceId,
        });
        this.sendSystemMessage(pairedId, 'error', payload);
      }
    }
  }
}
