/**
 * DeviceRegistry 单元测试
 *
 * 覆盖认证核心逻辑：
 * - registerDevice / unregisterDevice
 * - registerAccessToken / validateAccessToken
 * - 心跳超时清理
 * - Token 宽限期清理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeviceRegistry } from '../device-registry';

/** 创建一个最小的 WebSocket mock */
function createMockWs() {
  return {
    close: vi.fn(),
    send: vi.fn(),
    readyState: 1,
  } as unknown as import('ws').WebSocket;
}

describe('DeviceRegistry', () => {
  let registry: DeviceRegistry;

  beforeEach(() => {
    registry = new DeviceRegistry();
  });

  afterEach(() => {
    registry.stopCleanupTimer();
  });

  // --------------------------------------------------------------------------
  // registerDevice / unregisterDevice
  // --------------------------------------------------------------------------

  describe('registerDevice', () => {
    it('应注册设备并返回设备信息', () => {
      const ws = createMockWs();
      registry.registerDevice(ws, 'daemon-1', 'daemon', 'pk-1');

      const device = registry.getDevice('daemon-1');
      expect(device).toBeDefined();
      expect(device!.deviceType).toBe('daemon');
    });

    it('重复注册同一设备应断开旧连接', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      registry.registerDevice(ws1, 'daemon-1', 'daemon', 'pk-1');
      registry.registerDevice(ws2, 'daemon-1', 'daemon', 'pk-2');

      expect(ws1.close).toHaveBeenCalledWith(1000, '新连接替换旧连接');
      expect(registry.getWebSocket('daemon-1')).toBe(ws2);
    });

    it('daemon 注册时携带 accessToken 应自动注册 Token', () => {
      const ws = createMockWs();
      registry.registerDevice(ws, 'daemon-1', 'daemon', 'pk-1', 'mycc-test-token');

      const stats = registry.getStats();
      expect(stats.accessTokens).toBe(1);
    });

    it('client 注册时不应注册 Token', () => {
      const ws = createMockWs();
      registry.registerDevice(ws, 'client-1', 'client', 'pk-c1');

      const stats = registry.getStats();
      expect(stats.accessTokens).toBe(0);
    });
  });

  describe('unregisterDevice', () => {
    it('注销 daemon 时应标记 Token 待清理', () => {
      const ws = createMockWs();
      registry.registerDevice(ws, 'daemon-1', 'daemon', 'pk-1', 'mycc-test-token');
      registry.unregisterDevice('daemon-1');

      // daemon 已注销
      expect(registry.getDevice('daemon-1')).toBeUndefined();
      // Token 尚在宽限期内
      expect(registry.getStats().accessTokens).toBe(1);
    });

    it('daemon 重连时应清除 Token 待清理标记', () => {
      const ws1 = createMockWs();
      registry.registerDevice(ws1, 'daemon-1', 'daemon', 'pk-1', 'mycc-test-token');
      registry.unregisterDevice('daemon-1');

      // 重连
      const ws2 = createMockWs();
      registry.registerDevice(ws2, 'daemon-1', 'daemon', 'pk-1', 'mycc-test-token');

      // Token 应该仍然有效
      expect(registry.getStats().accessTokens).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // registerAccessToken / validateAccessToken
  // --------------------------------------------------------------------------

  describe('registerAccessToken', () => {
    it('应替换同一 daemon 的旧 Token', () => {
      const ws = createMockWs();
      registry.registerDevice(ws, 'daemon-1', 'daemon', 'pk-1');

      registry.registerAccessToken('daemon-1', 'token-old');
      registry.registerAccessToken('daemon-1', 'token-new');

      expect(registry.getStats().accessTokens).toBe(1);
    });
  });

  describe('validateAccessToken', () => {
    it('Token 有效时应建立配对关系并返回 daemonId', () => {
      const daemonWs = createMockWs();
      const clientWs = createMockWs();

      registry.registerDevice(daemonWs, 'daemon-1', 'daemon', 'pk-d1', 'mycc-valid-token');
      registry.registerDevice(clientWs, 'client-1', 'client', 'pk-c1');

      const result = registry.validateAccessToken('mycc-valid-token', 'client-1');
      expect(result).toBe('daemon-1');
      expect(registry.arePaired('daemon-1', 'client-1')).toBe(true);
    });

    it('Token 不存在时应返回 null', () => {
      const clientWs = createMockWs();
      registry.registerDevice(clientWs, 'client-1', 'client', 'pk-c1');

      const result = registry.validateAccessToken('nonexistent', 'client-1');
      expect(result).toBeNull();
    });

    it('client 未注册时应返回 null', () => {
      const daemonWs = createMockWs();
      registry.registerDevice(daemonWs, 'daemon-1', 'daemon', 'pk-d1', 'mycc-token');

      const result = registry.validateAccessToken('mycc-token', 'unregistered-client');
      expect(result).toBeNull();
    });

    it('daemon 离线时应返回 null', () => {
      const daemonWs = createMockWs();
      const clientWs = createMockWs();

      registry.registerDevice(daemonWs, 'daemon-1', 'daemon', 'pk-d1', 'mycc-token');
      registry.registerDevice(clientWs, 'client-1', 'client', 'pk-c1');

      // daemon 离线
      registry.unregisterDevice('daemon-1');

      const result = registry.validateAccessToken('mycc-token', 'client-1');
      expect(result).toBeNull();
    });

    it('deviceType 非 client 的设备不应通过认证', () => {
      const daemonWs = createMockWs();
      const daemon2Ws = createMockWs();

      registry.registerDevice(daemonWs, 'daemon-1', 'daemon', 'pk-d1', 'mycc-token');
      registry.registerDevice(daemon2Ws, 'daemon-2', 'daemon', 'pk-d2');

      const result = registry.validateAccessToken('mycc-token', 'daemon-2');
      expect(result).toBeNull();
    });

    it('同一 Token 可被多个 client 使用', () => {
      const daemonWs = createMockWs();
      const client1Ws = createMockWs();
      const client2Ws = createMockWs();

      registry.registerDevice(daemonWs, 'daemon-1', 'daemon', 'pk-d1', 'mycc-shared-token');
      registry.registerDevice(client1Ws, 'client-1', 'client', 'pk-c1');
      registry.registerDevice(client2Ws, 'client-2', 'client', 'pk-c2');

      expect(registry.validateAccessToken('mycc-shared-token', 'client-1')).toBe('daemon-1');
      expect(registry.validateAccessToken('mycc-shared-token', 'client-2')).toBe('daemon-1');

      // daemon 应与两个 client 都配对
      expect(registry.arePaired('daemon-1', 'client-1')).toBe(true);
      expect(registry.arePaired('daemon-1', 'client-2')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 心跳和清理
  // --------------------------------------------------------------------------

  describe('updateHeartbeat', () => {
    it('应更新设备心跳时间', async () => {
      const ws = createMockWs();
      registry.registerDevice(ws, 'device-1', 'client', 'pk-1');

      const before = registry.getDevice('device-1')!.lastHeartbeat;

      // 等待少量时间以确保 Date.now() 发生变化
      await new Promise((resolve) => setTimeout(resolve, 10));
      registry.updateHeartbeat('device-1');

      const after = registry.getDevice('device-1')!.lastHeartbeat;
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  describe('getStats', () => {
    it('应正确统计 daemon 和 client 数量', () => {
      registry.registerDevice(createMockWs(), 'd1', 'daemon', 'pk-1', 'token-1');
      registry.registerDevice(createMockWs(), 'd2', 'daemon', 'pk-2', 'token-2');
      registry.registerDevice(createMockWs(), 'c1', 'client', 'pk-3');

      const stats = registry.getStats();
      expect(stats.daemons).toBe(2);
      expect(stats.clients).toBe(1);
      expect(stats.accessTokens).toBe(2);
    });
  });

  describe('getPublicKey', () => {
    it('应返回设备公钥', () => {
      registry.registerDevice(createMockWs(), 'd1', 'daemon', 'pk-test');
      expect(registry.getPublicKey('d1')).toBe('pk-test');
    });

    it('设备不存在时应返回 undefined', () => {
      expect(registry.getPublicKey('nonexistent')).toBeUndefined();
    });
  });

  describe('getAllDeviceIds', () => {
    it('应返回所有设备 ID', () => {
      registry.registerDevice(createMockWs(), 'd1', 'daemon', 'pk-1');
      registry.registerDevice(createMockWs(), 'c1', 'client', 'pk-2');

      const ids = registry.getAllDeviceIds();
      expect(ids).toContain('d1');
      expect(ids).toContain('c1');
      expect(ids.length).toBe(2);
    });
  });
});
