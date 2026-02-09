/**
 * 设备注册管理模块
 *
 * 功能：
 * - 管理设备连接 (daemon/client)
 * - 配对码生成和验证
 * - 心跳检测和自动清理
 */

import type { WebSocket } from 'ws';
import type { DeviceType } from '@mycc/shared';

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
  /** 已配对的设备 ID（daemon 对应 client，client 对应 daemon） */
  pairedDeviceId?: string;
  /** 设备公钥 */
  publicKey?: string;
}

/** 配对信息 */
interface PairingEntry {
  /** 关联的 daemon 设备 ID */
  daemonId: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 过期时间戳 */
  expiresAt: number;
}

/** 配对码过期时间（5 分钟） */
const PAIRING_CODE_EXPIRY_MS = 5 * 60 * 1000;

/** 心跳超时时间（30 秒） */
const HEARTBEAT_TIMEOUT_MS = 30 * 1000;

/** 清理检查间隔（10 秒） */
const CLEANUP_INTERVAL_MS = 10 * 1000;

/**
 * 设备注册管理器
 */
export class DeviceRegistry {
  /** 设备 ID → 连接信息 */
  private devices: Map<string, DeviceConnection> = new Map();

  /** 配对码 → 配对信息 */
  private pairingCodes: Map<string, PairingEntry> = new Map();

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
   */
  registerDevice(
    ws: WebSocket,
    deviceId: string,
    deviceType: DeviceType,
    publicKey?: string
  ): void {
    // 如果设备已存在，先断开旧连接
    const existing = this.devices.get(deviceId);
    if (existing) {
      console.log(`[DeviceRegistry] 设备重复注册，断开旧连接: ${deviceId}`);
      existing.ws.close(1000, '新连接替换旧连接');
    }

    const now = Date.now();
    const device: DeviceConnection = {
      ws,
      deviceType,
      connectedAt: now,
      lastHeartbeat: now,
    };
    if (publicKey !== undefined) {
      device.publicKey = publicKey;
    }
    this.devices.set(deviceId, device);

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
   */
  unregisterDevice(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      return;
    }

    // 如果有配对设备，清除对方的配对关系
    if (device.pairedDeviceId) {
      const pairedDevice = this.devices.get(device.pairedDeviceId);
      if (pairedDevice) {
        delete pairedDevice.pairedDeviceId;
      }
    }

    // 如果是 daemon，清理其配对码
    if (device.deviceType === 'daemon') {
      for (const [code, entry] of this.pairingCodes.entries()) {
        if (entry.daemonId === deviceId) {
          this.pairingCodes.delete(code);
          console.log(`[DeviceRegistry] 配对码已清理: ${code}`);
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
   * 注册配对码（由 daemon 发起）
   * @param daemonId daemon 设备 ID
   * @param code 配对码
   * @param expiresAt 过期时间戳
   */
  registerPairingCode(daemonId: string, code: string, expiresAt: number): void {
    // 检查 daemon 是否已注册
    const daemon = this.devices.get(daemonId);
    if (!daemon || daemon.deviceType !== 'daemon') {
      throw new Error('设备未注册或非 daemon 类型');
    }

    // 清理该 daemon 的旧配对码
    for (const [existingCode, entry] of this.pairingCodes.entries()) {
      if (entry.daemonId === daemonId) {
        this.pairingCodes.delete(existingCode);
      }
    }

    this.pairingCodes.set(code, {
      daemonId,
      createdAt: Date.now(),
      expiresAt,
    });

    console.log(`[DeviceRegistry] 配对码已注册: ${code} (daemon: ${daemonId})`);
  }

  /**
   * 生成配对码
   * @param daemonId daemon 设备 ID
   * @returns 6 位数字配对码
   */
  generatePairingCode(daemonId: string): string {
    // 检查 daemon 是否已注册
    const daemon = this.devices.get(daemonId);
    if (!daemon || daemon.deviceType !== 'daemon') {
      throw new Error('设备未注册或非 daemon 类型');
    }

    // 清理该 daemon 的旧配对码
    for (const [code, entry] of this.pairingCodes.entries()) {
      if (entry.daemonId === daemonId) {
        this.pairingCodes.delete(code);
      }
    }

    // 生成 6 位随机数字
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const now = Date.now();
    this.pairingCodes.set(code, {
      daemonId,
      createdAt: now,
      expiresAt: now + PAIRING_CODE_EXPIRY_MS,
    });

    console.log(`[DeviceRegistry] 配对码已生成: ${code} (daemon: ${daemonId})`);
    return code;
  }

  /**
   * 验证配对码并完成配对
   * @param code 配对码
   * @param clientId client 设备 ID
   * @returns 配对成功返回 daemon ID，失败返回 null
   */
  validatePairingCode(code: string, clientId: string): string | null {
    const entry = this.pairingCodes.get(code);

    if (!entry) {
      console.log(`[DeviceRegistry] 配对码不存在: ${code}`);
      return null;
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      console.log(`[DeviceRegistry] 配对码已过期: ${code}`);
      this.pairingCodes.delete(code);
      return null;
    }

    // 检查 client 是否已注册
    const client = this.devices.get(clientId);
    if (!client || client.deviceType !== 'client') {
      console.log(`[DeviceRegistry] client 未注册或类型错误: ${clientId}`);
      return null;
    }

    // 检查 daemon 是否仍在线
    const daemon = this.devices.get(entry.daemonId);
    if (!daemon) {
      console.log(`[DeviceRegistry] daemon 已离线: ${entry.daemonId}`);
      this.pairingCodes.delete(code);
      return null;
    }

    // 完成配对
    daemon.pairedDeviceId = clientId;
    client.pairedDeviceId = entry.daemonId;

    // 删除已使用的配对码
    this.pairingCodes.delete(code);

    console.log(`[DeviceRegistry] 配对成功: ${clientId} <-> ${entry.daemonId}`);
    return entry.daemonId;
  }

  /**
   * 获取设备的配对设备 ID
   * @param deviceId 设备 ID
   * @returns 配对设备 ID 或 undefined
   */
  getPairedDeviceId(deviceId: string): string | undefined {
    return this.devices.get(deviceId)?.pairedDeviceId;
  }

  /**
   * 检查两个设备是否已配对
   * @param deviceId1 设备 1 ID
   * @param deviceId2 设备 2 ID
   * @returns 是否已配对
   */
  arePaired(deviceId1: string, deviceId2: string): boolean {
    const device1 = this.devices.get(deviceId1);
    return device1?.pairedDeviceId === deviceId2;
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
  getStats(): { daemons: number; clients: number; pairingCodes: number } {
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
      pairingCodes: this.pairingCodes.size,
    };
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredConnections();
      this.cleanupExpiredPairingCodes();
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * 清理超时连接
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
  }

  /**
   * 清理过期配对码
   */
  private cleanupExpiredPairingCodes(): void {
    const now = Date.now();

    for (const [code, entry] of this.pairingCodes.entries()) {
      if (now > entry.expiresAt) {
        this.pairingCodes.delete(code);
        console.log(`[DeviceRegistry] 配对码过期已清理: ${code}`);
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
   * 清空所有设备和配对码（用于测试）
   */
  clear(): void {
    for (const device of this.devices.values()) {
      device.ws.close(1000, '服务关闭');
    }
    this.devices.clear();
    this.pairingCodes.clear();
  }
}
