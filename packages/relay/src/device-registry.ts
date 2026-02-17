/**
 * 设备注册管理模块
 *
 * 功能：
 * - 管理设备连接 (daemon/client)
 * - Access Token 注册和验证
 * - 心跳检测和自动清理
 */

import type { WebSocket } from 'ws';
import type { DeviceType, OnlineDaemon } from '@opentermux/shared';

/** 设备连接信息 */
interface DeviceConnection {
  /** WebSocket 连接 */
  ws: WebSocket;
  /** 设备类型 */
  deviceType: DeviceType;
  /** 连接时间戳 */
  connectedAt: number;
  /** 最后心跳时间 */
  lastHeartbeat: number;
  /** 已认证对端设备 ID 集合（daemon 可对应多个 client，client 仅对应一个 daemon） */
  authenticatedPeerIds: Set<string>;
  /** 设备公钥 */
  publicKey?: string;
}

/** Access Token 注册信息 */
interface TokenEntry {
  /** 关联的 daemon 设备 ID */
  daemonId: string;
  /** 注册时间戳 */
  registeredAt: number;
  /** daemon 断开时间戳（用于延迟清理，undefined 表示 daemon 在线） */
  disconnectedAt?: number;
}

/** 心跳超时时间（30 秒） */
const HEARTBEAT_TIMEOUT_MS = 30 * 1000;

/** 清理检查间隔（10 秒） */
const CLEANUP_INTERVAL_MS = 10 * 1000;

/** Daemon 断开后 Access Token 保留时间（60 秒，支持短暂断线重连） */
const TOKEN_GRACE_PERIOD_MS = 60 * 1000;

/**
 * 设备注册管理器
 */
export class DeviceRegistry {
  /** 设备 ID → 连接信息 */
  private devices: Map<string, DeviceConnection> = new Map();

  /** Access Token → Token 注册信息 */
  private accessTokens: Map<string, TokenEntry> = new Map();

  /** 清理定时器 */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  /**
   * 注册设备
   * @param ws WebSocket 连接
   * @param deviceId 设备唯一标识
   * @param deviceType 设备类型
   * @param publicKey 设备公钥（可选）
   * @param accessToken daemon 的 Access Token（可选，仅 daemon 提供）
   */
  registerDevice(
    ws: WebSocket,
    deviceId: string,
    deviceType: DeviceType,
    publicKey?: string,
    accessToken?: string
  ): void {
    // 如果设备已存在，先断开旧连接（同一 ws 重复注册时跳过关闭）
    const existing = this.devices.get(deviceId);
    if (existing && existing.ws !== ws) {
      console.log(`[DeviceRegistry] 设备重复注册，断开旧连接: ${deviceId}`);
      existing.ws.close(1000, '新连接替换旧连接');
    } else if (existing) {
      // 同一 ws 重复注册（如 token_auth 流程），仅更新元数据，保留认证关系
      console.log(`[DeviceRegistry] 同一 ws 重复注册，更新设备信息: ${deviceId}`);
      existing.lastHeartbeat = Date.now();
      if (publicKey !== undefined) existing.publicKey = publicKey;
      // 处理 daemon 的 accessToken
      if (deviceType === 'daemon') {
        if (accessToken) {
          this.registerAccessToken(deviceId, accessToken);
        }
        for (const [, entry] of this.accessTokens.entries()) {
          if (entry.daemonId === deviceId && entry.disconnectedAt) {
            delete entry.disconnectedAt;
          }
        }
      }
      return;
    }

    const now = Date.now();
    const device: DeviceConnection = {
      ws,
      deviceType,
      connectedAt: now,
      lastHeartbeat: now,
      authenticatedPeerIds: new Set(),
      // S1: 保留条件展开以兼容 exactOptionalPropertyTypes（publicKey 为 undefined 时不赋值）
      ...(publicKey !== undefined && { publicKey }),
    };
    this.devices.set(deviceId, device);

    // I10: 合并两个 daemon 类型检查为一个代码块
    if (deviceType === 'daemon') {
      // 如果携带 accessToken，注册 Token
      if (accessToken) {
        this.registerAccessToken(deviceId, accessToken);
      }

      // 如果是 daemon 重连，清除其 Token 的待清理标记
      for (const [, entry] of this.accessTokens.entries()) {
        if (entry.daemonId === deviceId && entry.disconnectedAt) {
          delete entry.disconnectedAt;
          console.log(`[DeviceRegistry] daemon 重连，取消 Token 待清理标记: ${deviceId}`);
        }
      }
    }

    console.log(`[DeviceRegistry] 设备已注册: ${deviceId} (${deviceType})`);
  }

  /**
   * 获取设备公钥
   * @param deviceId 设备 ID
   * @returns 公钥或 undefined
   */
  getPublicKey(deviceId: string): string | undefined {
    return this.devices.get(deviceId)?.publicKey;
  }

  /**
   * 注销设备
   * @param deviceId 设备 ID
   *
   * 注意：设备断开时不清除对方的认证关系，以支持断线重连。
   */
  unregisterDevice(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      return;
    }

    // 如果是 daemon，标记其 Access Token 为待清理（延迟删除以支持断线重连）
    if (device.deviceType === 'daemon') {
      const now = Date.now();
      for (const [, entry] of this.accessTokens.entries()) {
        if (entry.daemonId === deviceId) {
          entry.disconnectedAt = now;
          console.log(`[DeviceRegistry] Access Token 已标记待清理 (daemon: ${deviceId}, 宽限期 ${TOKEN_GRACE_PERIOD_MS / 1000}s)`);
        }
      }
    }

    this.devices.delete(deviceId);
    console.log(`[DeviceRegistry] 设备已注销: ${deviceId}`);
  }

  /**
   * 获取设备连接
   * @param deviceId 设备 ID
   * @returns 设备连接信息或 undefined
   */
  getDevice(deviceId: string): DeviceConnection | undefined {
    return this.devices.get(deviceId);
  }

  /**
   * 获取设备的 WebSocket
   * @param deviceId 设备 ID
   * @returns WebSocket 或 undefined
   */
  getWebSocket(deviceId: string): WebSocket | undefined {
    return this.devices.get(deviceId)?.ws;
  }

  /**
   * 更新设备心跳时间
   * @param deviceId 设备 ID
   */
  updateHeartbeat(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastHeartbeat = Date.now();
    }
  }

  /**
   * 注册 Access Token（由 daemon 发起）
   * @param daemonId daemon 设备 ID
   * @param token Access Token
   */
  registerAccessToken(daemonId: string, token: string): void {
    // 清理该 daemon 的旧 Token
    for (const [existingToken, entry] of this.accessTokens.entries()) {
      if (entry.daemonId === daemonId) {
        this.accessTokens.delete(existingToken);
      }
    }

    this.accessTokens.set(token, {
      daemonId,
      registeredAt: Date.now(),
    });

    console.log(`[DeviceRegistry] Access Token 已注册 (daemon: ${daemonId})`);
  }

  /**
   * 验证 Access Token 并完成认证
   * @param token Access Token
   * @param clientId client 设备 ID
   * @returns 认证成功返回 daemon ID，失败返回 null
   */
  validateAccessToken(token: string, clientId: string): string | null {
    const entry = this.accessTokens.get(token);

    if (!entry) {
      console.log(`[DeviceRegistry] Access Token 不存在`);
      return null;
    }

    // 检查 client 是否已注册
    const client = this.devices.get(clientId);
    if (!client) {
      console.log(`[DeviceRegistry] client 未注册: ${clientId}`);
      return null;
    }

    // 防御性检查：确保发起认证的是 client 而非 daemon
    if (client.deviceType !== 'client') {
      console.log(`[DeviceRegistry] 设备类型不匹配，预期 client，实际 ${client.deviceType}: ${clientId}`);
      return null;
    }

    // 检查 daemon 是否仍在线
    const daemon = this.devices.get(entry.daemonId);
    if (!daemon) {
      console.log(`[DeviceRegistry] daemon 已离线: ${entry.daemonId}`);
      return null;
    }

    // 完成认证（Token 不销毁，可以被多个 client 使用）
    daemon.authenticatedPeerIds.add(clientId);
    client.authenticatedPeerIds.add(entry.daemonId);

    console.log(`[DeviceRegistry] Token 认证成功: ${clientId} <-> ${entry.daemonId}`);
    return entry.daemonId;
  }

  /**
   * 获取设备的已认证对端 ID 集合
   * @param deviceId 设备 ID
   * @returns 已认证对端 ID 集合或 undefined
   */
  getAuthenticatedPeerIds(deviceId: string): Set<string> | undefined {
    return this.devices.get(deviceId)?.authenticatedPeerIds;
  }

  /**
   * 检查两个设备是否已建立认证关系
   * @param deviceId1 设备 1 ID
   * @param deviceId2 设备 2 ID
   * @returns 是否已认证
   */
  arePeersAuthenticated(deviceId1: string, deviceId2: string): boolean {
    const device1 = this.devices.get(deviceId1);
    return device1?.authenticatedPeerIds.has(deviceId2) ?? false;
  }

  /**
   * 获取所有已注册设备的 ID
   * @returns 设备 ID 数组
   */
  getAllDeviceIds(): string[] {
    return Array.from(this.devices.keys());
  }

  /**
   * 获取注册统计信息
   */
  getStats(): { daemons: number; clients: number; accessTokens: number } {
    let daemons = 0;
    let clients = 0;

    for (const device of this.devices.values()) {
      if (device.deviceType === 'daemon') {
        daemons++;
      } else {
        clients++;
      }
    }

    return {
      daemons,
      clients,
      accessTokens: this.accessTokens.size,
    };
  }

  /**
   * 获取在线 daemon 快照（用于 Web 管理中心）
   */
  getOnlineDaemons(): OnlineDaemon[] {
    const daemons: OnlineDaemon[] = [];

    for (const [daemonId, device] of this.devices.entries()) {
      if (device.deviceType !== 'daemon') {
        continue;
      }

      let connectedClients = 0;
      for (const peerId of device.authenticatedPeerIds) {
        const peer = this.devices.get(peerId);
        if (peer?.deviceType === 'client') {
          connectedClients++;
        }
      }

      daemons.push({
        daemonId,
        connectedAt: device.connectedAt,
        lastHeartbeat: device.lastHeartbeat,
        connectedClients,
      });
    }

    daemons.sort((a, b) => b.lastHeartbeat - a.lastHeartbeat);
    return daemons;
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredConnections();
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * 清理超时连接和过期 Token
   */
  private cleanupExpiredConnections(): void {
    const now = Date.now();
    const expiredDevices: string[] = [];

    for (const [deviceId, device] of this.devices.entries()) {
      if (now - device.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        expiredDevices.push(deviceId);
      }
    }

    for (const deviceId of expiredDevices) {
      console.log(`[DeviceRegistry] 心跳超时，断开连接: ${deviceId}`);
      const device = this.devices.get(deviceId);
      if (device) {
        device.ws.close(1000, '心跳超时');
        this.unregisterDevice(deviceId);
      }
    }

    // 清理超过宽限期的 Access Token
    for (const [token, entry] of this.accessTokens.entries()) {
      if (entry.disconnectedAt && now - entry.disconnectedAt > TOKEN_GRACE_PERIOD_MS) {
        this.accessTokens.delete(token);
        console.log(`[DeviceRegistry] Access Token 宽限期已过，已清理 (daemon: ${entry.daemonId})`);
      }
    }
  }

  /**
   * 停止清理定时器（用于测试或关闭服务）
   */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 清空所有设备和 Token（用于测试）
   */
  clear(): void {
    for (const device of this.devices.values()) {
      device.ws.close(1000, '服务关闭');
    }
    this.devices.clear();
    this.accessTokens.clear();
  }
}
