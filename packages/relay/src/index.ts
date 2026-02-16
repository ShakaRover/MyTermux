/**
 * @opentermux/relay 中继服务器入口
 *
 * 功能：
 * - 启动 HTTP 服务器（Hono + @hono/node-server）
 * - 集成 WebSocket 服务器（ws 库）
 * - 初始化设备注册管理和消息路由
 */

import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import type { Server as HttpServer } from 'node:http';
import { createServer } from './server.js';
import { DeviceRegistry } from './device-registry.js';
import { MessageRouter } from './message-router.js';
import { WebSocketHandler } from './websocket-handler.js';

// 从环境变量获取端口和地址
const port = Number(process.env['PORT']) || 3000;
const hostname = process.env['HOST'] || '0.0.0.0';

// 初始化核心组件
const deviceRegistry = new DeviceRegistry();
const messageRouter = new MessageRouter(deviceRegistry);
const wsHandler = new WebSocketHandler(deviceRegistry, messageRouter);

// 创建 Hono 应用
const app = createServer({ deviceRegistry });

console.log(`[Relay] OpenTermux Relay Server 启动中，地址: ${hostname}:${port}...`);

// 启动 HTTP 服务器
const httpServer = serve({
  fetch: app.fetch,
  port,
  hostname,
});

// 创建 WebSocket 服务器，附加到 HTTP 服务器
// 使用类型断言处理 @hono/node-server 返回的服务器类型
const wss = new WebSocketServer({
  server: httpServer as unknown as HttpServer,
  path: '/ws',
});

// 处理 WebSocket 连接
wss.on('connection', (ws) => {
  wsHandler.handleConnection(ws);
});

// 处理 WebSocket 服务器错误
wss.on('error', (error) => {
  console.error('[Relay] WebSocket 服务器错误:', error);
});

console.log(`[Relay] OpenTermux Relay Server 已启动`);
console.log(`[Relay] HTTP: http://${hostname}:${port}`);
console.log(`[Relay] WebSocket: ws://${hostname}:${port}/ws`);
console.log(`[Relay] 健康检查: http://${hostname}:${port}/health`);

// 优雅关闭处理
function gracefulShutdown(signal: string): void {
  console.log(`\n[Relay] 收到 ${signal} 信号，正在关闭服务器...`);

  // 停止清理定时器
  deviceRegistry.stopCleanupTimer();

  // 关闭所有 WebSocket 连接
  wss.clients.forEach((client) => {
    client.close(1001, '服务器关闭');
  });

  // 关闭 WebSocket 服务器
  wss.close(() => {
    console.log('[Relay] WebSocket 服务器已关闭');
  });

  // 关闭 HTTP 服务器
  httpServer.close(() => {
    console.log('[Relay] HTTP 服务器已关闭');
    process.exit(0);
  });

  // 强制退出超时
  setTimeout(() => {
    console.error('[Relay] 强制退出');
    process.exit(1);
  }, 10000);
}

// 注册信号处理
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 导出供测试使用
export { app, wss, deviceRegistry, messageRouter, wsHandler };
