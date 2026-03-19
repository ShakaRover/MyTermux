/**
 * WebSocketHandler 单元测试
 *
 * 覆盖核心逻辑：
 * - handleClose 中的 ws 身份检查（旧 ws 关闭不注销新连接）
 * - cleanupOldWsMapping 旧 ws 反向映射清理
 * - handleRegister / handleTokenAuth 基本流程
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { WebSocketHandler } from '../websocket-handler';
import type { DeviceRegistry } from '../device-registry';
import type { MessageRouter } from '../message-router';
import { createTransportMessage } from '@mytermux/shared';
import type { WsTicketService } from '../auth/ws-ticket';

// ============================================================================
// Mock 工具
// ============================================================================

/** 创建模拟 WebSocket（模拟 Node.js ws 库的 EventEmitter 接口） */
function createMockWs() {
  const emitter = new EventEmitter();
  const ws = Object.assign(emitter, {
    close: vi.fn(),
    send: vi.fn(),
    readyState: 1, // WebSocket.OPEN
  });
  return ws as unknown as import('ws').WebSocket;
}

/** 创建模拟 DeviceRegistry */
function createMockRegistry(): DeviceRegistry {
  return {
    registerDevice: vi.fn(),
    unregisterDevice: vi.fn(),
    getDevice: vi.fn(),
    getWebSocket: vi.fn(),
    getPublicKey: vi.fn(),
    validateAccessToken: vi.fn(),
    updateHeartbeat: vi.fn(),
    arePeersAuthenticated: vi.fn(),
    getAuthenticatedPeerIds: vi.fn(),
    getAllDeviceIds: vi.fn(),
    getStats: vi.fn(),
    startCleanupTimer: vi.fn(),
    stopCleanupTimer: vi.fn(),
    registerAccessToken: vi.fn(),
  } as unknown as DeviceRegistry;
}

/** 创建模拟 MessageRouter */
function createMockRouter(): MessageRouter {
  return {
    routeMessage: vi.fn().mockReturnValue({ success: true }),
    broadcastToPaired: vi.fn().mockReturnValue({ success: true }),
    sendSystemMessage: vi.fn().mockReturnValue({ success: true }),
    sendError: vi.fn().mockReturnValue({ success: true }),
    sendHeartbeatAck: vi.fn().mockReturnValue({ success: true }),
    notifyPeerDisconnected: vi.fn(),
  } as unknown as MessageRouter;
}

/** 创建模拟 WsTicketService */
function createMockWsTicketService(): WsTicketService {
  return {
    issue: vi.fn(),
    consume: vi.fn(),
  } as unknown as WsTicketService;
}

/** 模拟发送注册消息并等待处理 */
function sendRegisterMessage(
  ws: import('ws').WebSocket,
  deviceId: string,
  deviceType: 'daemon' | 'client',
  publicKey: string,
  accessToken?: string,
  daemonLinkToken?: string,
) {
  const payload = JSON.stringify({
    deviceType,
    publicKey,
    ...(accessToken && { accessToken }),
    ...(daemonLinkToken && { daemonLinkToken }),
  });
  const message = createTransportMessage('register', deviceId, payload);
  (ws as unknown as EventEmitter).emit('message', Buffer.from(JSON.stringify(message)));
}

/** 模拟发送 token_auth 消息 */
function sendTokenAuthMessage(
  ws: import('ws').WebSocket,
  clientId: string,
  publicKey: string,
  accessToken?: string,
) {
  const payload = JSON.stringify({ deviceType: 'client', publicKey, ...(accessToken ? { accessToken } : {}) });
  const message = createTransportMessage('token_auth', clientId, payload);
  (ws as unknown as EventEmitter).emit('message', Buffer.from(JSON.stringify(message)));
}

/** 模拟发送普通路由消息 */
function sendRoutedMessage(
  ws: import('ws').WebSocket,
  from: string,
  to: string,
  payload = 'encrypted-payload',
) {
  const message = createTransportMessage('message', from, payload, to);
  (ws as unknown as EventEmitter).emit('message', Buffer.from(JSON.stringify(message)));
}

/** 模拟发送心跳消息 */
function sendHeartbeatMessage(ws: import('ws').WebSocket, from: string) {
  const message = createTransportMessage('heartbeat', from, '');
  (ws as unknown as EventEmitter).emit('message', Buffer.from(JSON.stringify(message)));
}

/** 模拟触发 ws close 事件 */
function triggerClose(ws: import('ws').WebSocket, code = 1000, reason = '') {
  (ws as unknown as EventEmitter).emit('close', code, Buffer.from(reason));
}

// ============================================================================
// 测试
// ============================================================================

describe('WebSocketHandler', () => {
  let handler: WebSocketHandler;
  let registry: DeviceRegistry;
  let router: MessageRouter;
  let wsTicketService: WsTicketService;

  beforeEach(() => {
    registry = createMockRegistry();
    router = createMockRouter();
    wsTicketService = createMockWsTicketService();
    vi.mocked(wsTicketService.consume).mockImplementation((ticket: string) => ({
      ticket,
      daemonToken: 'valid-token',
      accessToken: 'valid-token',
      profileId: 'profile-1',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      daemonId: 'daemon-1',
    }));
    handler = new WebSocketHandler(registry, router, wsTicketService);
  });

  // --------------------------------------------------------------------------
  // handleClose - ws 身份检查
  // --------------------------------------------------------------------------

  describe('handleClose - ws 身份检查', () => {
    it('当前 ws 关闭时应注销设备并通知已认证对端设备', () => {
      const ws = createMockWs();
      handler.handleConnection(ws, '/ws?ticket=ticket-1');

      // 模拟注册
      sendRegisterMessage(ws, 'client-1', 'client', 'pk-1');

      // 模拟 getWebSocket 返回当前 ws（说明未被替换）
      vi.mocked(registry.getWebSocket).mockReturnValue(ws);

      // 触发关闭
      triggerClose(ws, 1000, '正常关闭');

      // 应该通知已认证对端设备并注销
      expect(router.notifyPeerDisconnected).toHaveBeenCalledWith('client-1');
      expect(registry.unregisterDevice).toHaveBeenCalledWith('client-1');
    });

    it('旧 ws 关闭时不应注销新连接的注册信息', () => {
      const oldWs = createMockWs();
      const newWs = createMockWs();

      handler.handleConnection(oldWs, '/ws?ticket=ticket-old');
      handler.handleConnection(newWs, '/ws?ticket=ticket-new');

      // 旧 ws 注册 client-1
      sendRegisterMessage(oldWs, 'client-1', 'client', 'pk-old');

      // 新 ws 注册 client-1（重连场景）
      // cleanupOldWsMapping 会在此时清理旧 ws 映射
      vi.mocked(registry.getWebSocket).mockReturnValue(oldWs);
      sendRegisterMessage(newWs, 'client-1', 'client', 'pk-new');

      // 重置 mock，模拟 getWebSocket 现在返回 newWs
      vi.mocked(registry.getWebSocket).mockReturnValue(newWs);
      vi.mocked(router.notifyPeerDisconnected).mockClear();
      vi.mocked(registry.unregisterDevice).mockClear();

      // 旧 ws 关闭
      triggerClose(oldWs, 1000, '新连接替换旧连接');

      // 旧 ws 已被 cleanupOldWsMapping 从映射中移除，
      // 所以 handleClose 找不到 deviceId，不会注销新连接
      expect(router.notifyPeerDisconnected).not.toHaveBeenCalled();
      expect(registry.unregisterDevice).not.toHaveBeenCalled();
    });

    it('旧 ws 关闭时（映射未清理情况下）应通过 ws 身份检查保护新连接', () => {
      // 此测试覆盖：即使 cleanupOldWsMapping 未被调用（理论上不会发生），
      // handleClose 中的 currentWs === ws 检查也能保护新连接
      const oldWs = createMockWs();
      handler.handleConnection(oldWs, '/ws?ticket=ticket-old');

      // 注册 client-1
      sendRegisterMessage(oldWs, 'client-1', 'client', 'pk-old');

      // 直接模拟：getWebSocket 返回的 ws 和正在关闭的 ws 不同（新连接已替换）
      const differentWs = createMockWs();
      vi.mocked(registry.getWebSocket).mockReturnValue(differentWs);

      // 触发旧 ws 关闭
      triggerClose(oldWs, 1000, '旧连接关闭');

      // handleClose 发现 currentWs !== ws，不注销
      expect(registry.unregisterDevice).not.toHaveBeenCalled();
      expect(router.notifyPeerDisconnected).not.toHaveBeenCalled();
    });

    it('未注册的 ws 关闭不应触发任何注销或通知', () => {
      const ws = createMockWs();
      handler.handleConnection(ws, '/ws?ticket=ticket-1');

      // 不发送注册消息，直接关闭
      triggerClose(ws, 1000, '未注册');

      expect(registry.unregisterDevice).not.toHaveBeenCalled();
      expect(router.notifyPeerDisconnected).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // cleanupOldWsMapping
  // --------------------------------------------------------------------------

  describe('cleanupOldWsMapping - 反向映射清理', () => {
    it('同一 deviceId 用新 ws 注册后，旧 ws 关闭应无副作用', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      handler.handleConnection(ws1, '/ws?ticket=ticket-1');
      handler.handleConnection(ws2, '/ws?ticket=ticket-2');

      // ws1 注册 daemon-1
      sendRegisterMessage(ws1, 'daemon-1', 'daemon', 'pk-1', 'token-1');

      // ws2 注册同一 daemon-1（重连），触发 cleanupOldWsMapping
      vi.mocked(registry.getWebSocket).mockReturnValue(ws1); // 返回旧 ws
      sendRegisterMessage(ws2, 'daemon-1', 'daemon', 'pk-2', 'token-1');

      // 现在 getWebSocket 返回 ws2
      vi.mocked(registry.getWebSocket).mockReturnValue(ws2);
      vi.mocked(registry.unregisterDevice).mockClear();

      // ws1 关闭 - 已被清理，不应触发注销
      triggerClose(ws1, 1000, '旧连接关闭');
      expect(registry.unregisterDevice).not.toHaveBeenCalled();

      // ws2 关闭 - 当前连接，应触发注销
      triggerClose(ws2, 1000, '正常关闭');
      expect(registry.unregisterDevice).toHaveBeenCalledWith('daemon-1');
    });

    it('token_auth 重连场景：新 ws 替换后旧 ws 安全关闭', () => {
      const oldWs = createMockWs();
      const newWs = createMockWs();

      handler.handleConnection(oldWs, '/ws?ticket=ticket-old');
      handler.handleConnection(newWs, '/ws?ticket=ticket-new');

      // 旧 ws 先 register
      sendRegisterMessage(oldWs, 'client-1', 'client', 'pk-old');

      // 新 ws 通过 token_auth 认证（会先调用 cleanupOldWsMapping）
      vi.mocked(registry.getWebSocket).mockReturnValue(oldWs);
      vi.mocked(registry.validateAccessToken).mockReturnValue('daemon-1');
      vi.mocked(registry.getPublicKey).mockReturnValue('daemon-pk');
      sendTokenAuthMessage(newWs, 'client-1', 'pk-new', 'valid-token');

      // getWebSocket 现在返回 newWs
      vi.mocked(registry.getWebSocket).mockReturnValue(newWs);
      vi.mocked(registry.unregisterDevice).mockClear();

      // 旧 ws 关闭
      triggerClose(oldWs, 1000, '旧连接关闭');

      // 不应注销新连接
      expect(registry.unregisterDevice).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // handleRegister 基本流程
  // --------------------------------------------------------------------------

  describe('handleRegister', () => {
    it('应成功注册设备并发送确认消息', () => {
      const ws = createMockWs();
      handler.handleConnection(ws, '/ws?ticket=ticket-1');

      sendRegisterMessage(ws, 'daemon-1', 'daemon', 'pk-1', 'token-1');

      expect(registry.registerDevice).toHaveBeenCalledWith(
        ws, 'daemon-1', 'daemon', 'pk-1', 'token-1',
      );
      expect(ws.send).toHaveBeenCalled();

      // 验证发送的确认消息
      const sentData = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
      expect(sentData.type).toBe('register');
      const sentPayload = JSON.parse(sentData.payload);
      expect(sentPayload.success).toBe(true);
      expect(sentPayload.deviceId).toBe('daemon-1');
    });

    it('无效 JSON payload 应发送错误', () => {
      const ws = createMockWs();
      handler.handleConnection(ws, '/ws?ticket=ticket-1');

      const message = createTransportMessage('register', 'client-1', 'not-json{');
      (ws as unknown as EventEmitter).emit('message', Buffer.from(JSON.stringify(message)));

      // 应发送错误消息
      expect(ws.send).toHaveBeenCalled();
      const sentData = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
      expect(sentData.type).toBe('error');
    });

    it('开启 daemonLinkToken 后，daemon 使用错误 token 应被拒绝', () => {
      const strictHandler = new WebSocketHandler(registry, router, wsTicketService, {
        daemonLinkToken: 'relay-daemon-link-token',
      });
      const ws = createMockWs();
      strictHandler.handleConnection(ws);

      sendRegisterMessage(ws, 'daemon-1', 'daemon', 'pk-1', 'token-1', 'wrong-token');

      expect(registry.registerDevice).not.toHaveBeenCalled();
      expect(ws.close).toHaveBeenCalledWith(4006, 'Daemon Link Token 无效');
    });

    it('开启 daemonLinkToken 后，daemon 使用正确 token 应允许注册', () => {
      const strictHandler = new WebSocketHandler(registry, router, wsTicketService, {
        daemonLinkToken: 'relay-daemon-link-token',
      });
      const ws = createMockWs();
      strictHandler.handleConnection(ws);

      sendRegisterMessage(ws, 'daemon-1', 'daemon', 'pk-1', 'token-1', 'relay-daemon-link-token');

      expect(registry.registerDevice).toHaveBeenCalledWith(
        ws, 'daemon-1', 'daemon', 'pk-1', 'token-1',
      );
    });
  });

  // --------------------------------------------------------------------------
  // handleTokenAuth 基本流程
  // --------------------------------------------------------------------------

  describe('handleTokenAuth', () => {
    it('Token 有效时应发送成功响应给 client 和 daemon', () => {
      const ws = createMockWs();
      handler.handleConnection(ws, '/ws?ticket=ticket-1');

      vi.mocked(registry.getWebSocket).mockReturnValue(undefined as unknown as import('ws').WebSocket);
      vi.mocked(registry.validateAccessToken).mockReturnValue('daemon-1');
      vi.mocked(registry.getPublicKey).mockReturnValue('daemon-pk');

      sendTokenAuthMessage(ws, 'client-1', 'pk-c1', 'valid-token');

      // 应注册设备
      expect(registry.registerDevice).toHaveBeenCalledWith(
        ws, 'client-1', 'client', 'pk-c1',
      );

      // 应发送 token_ack 给 client
      expect(ws.send).toHaveBeenCalled();
      const sentData = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
      expect(sentData.type).toBe('token_ack');
      const payload = JSON.parse(sentData.payload);
      expect(payload.success).toBe(true);
      expect(payload.daemonId).toBe('daemon-1');

      // 应通知 daemon
      expect(router.sendSystemMessage).toHaveBeenCalledWith(
        'daemon-1', 'token_ack', expect.any(String),
      );
    });

    it('Token 无效时应发送失败响应并关闭连接', () => {
      const ws = createMockWs();
      handler.handleConnection(ws, '/ws?ticket=ticket-1');

      vi.mocked(registry.getWebSocket).mockReturnValue(undefined as unknown as import('ws').WebSocket);
      vi.mocked(registry.validateAccessToken).mockReturnValue(null);

      sendTokenAuthMessage(ws, 'client-1', 'pk-c1');

      // 应发送失败 token_ack
      const sentData = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
      const payload = JSON.parse(sentData.payload);
      expect(payload.success).toBe(false);

      // 应注销设备并关闭连接
      expect(registry.unregisterDevice).toHaveBeenCalledWith('client-1');
      expect(ws.close).toHaveBeenCalledWith(4001, 'Token 认证失败');
    });

    it('ws-ticket 与 payload token 不一致时应拒绝认证并关闭连接', () => {
      const ws = createMockWs();
      handler.handleConnection(ws, '/ws?ticket=ticket-1');

      vi.mocked(registry.getWebSocket).mockReturnValue(undefined as unknown as import('ws').WebSocket);
      vi.mocked(registry.validateAccessToken).mockReturnValue('daemon-1');

      sendTokenAuthMessage(ws, 'client-1', 'pk-c1', 'another-token');

      expect(registry.validateAccessToken).not.toHaveBeenCalled();
      expect(registry.unregisterDevice).toHaveBeenCalledWith('client-1');
      expect(ws.close).toHaveBeenCalledWith(4002, 'MYTERMUX_DAEMON_TOKEN 与 ws ticket 不一致');
    });
  });

  // --------------------------------------------------------------------------
  // 连接身份绑定校验（防止伪造 from）
  // --------------------------------------------------------------------------

  describe('sender binding', () => {
    it('未注册连接发送 message 时应拒绝并关闭连接', () => {
      const ws = createMockWs();
      handler.handleConnection(ws, '/ws?ticket=ticket-1');

      sendRoutedMessage(ws, 'client-1', 'daemon-1');

      expect(router.routeMessage).not.toHaveBeenCalled();
      expect(ws.close).toHaveBeenCalledWith(4004, '连接尚未完成注册或认证');
    });

    it('已注册连接伪造 from 发送 message 时应拒绝并关闭连接', () => {
      const ws = createMockWs();
      handler.handleConnection(ws, '/ws?ticket=ticket-1');
      sendRegisterMessage(ws, 'client-1', 'client', 'pk-1');

      vi.mocked(router.routeMessage).mockClear();
      sendRoutedMessage(ws, 'client-2', 'daemon-1');

      expect(router.routeMessage).not.toHaveBeenCalled();
      expect(ws.close).toHaveBeenCalledWith(4005, '消息来源与连接身份不一致');
    });

    it('已注册连接伪造 from 发送 heartbeat 时应拒绝并关闭连接', () => {
      const ws = createMockWs();
      handler.handleConnection(ws, '/ws?ticket=ticket-1');
      sendRegisterMessage(ws, 'client-1', 'client', 'pk-1');

      vi.mocked(registry.updateHeartbeat).mockClear();
      sendHeartbeatMessage(ws, 'client-2');

      expect(registry.updateHeartbeat).not.toHaveBeenCalled();
      expect(ws.close).toHaveBeenCalledWith(4005, '消息来源与连接身份不一致');
    });
  });

  // --------------------------------------------------------------------------
  // 连接统计
  // --------------------------------------------------------------------------

  describe('getStats', () => {
    it('应反映活跃连接数', () => {
      expect(handler.getStats().activeConnections).toBe(0);

      const ws = createMockWs();
      handler.handleConnection(ws, '/ws?ticket=ticket-1');
      sendRegisterMessage(ws, 'client-1', 'client', 'pk-1');

      expect(handler.getStats().activeConnections).toBe(1);
    });
  });
});
