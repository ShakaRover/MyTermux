/**
 * @mytermux/relay Server 入口
 */

import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { initializeRelayRuntime } from './runtime.js';

// 从环境变量获取端口和地址
const port = Number(process.env['PORT']) || 62200;
const hostname = process.env['HOST'] || '127.0.0.1';

// 初始化核心组件
const runtime = initializeRelayRuntime();
const { app, deviceRegistry, wsHandler } = runtime;

console.log(`[Server] MyTermux Server 启动中，地址: ${hostname}:${port}...`);

// 启动 HTTP 服务器
const httpServer = serve({
  fetch: app.fetch,
  port,
  hostname,
});

// 创建 WebSocket 服务器，附加到 HTTP 服务器
const wss = new WebSocketServer({
  server: httpServer as unknown as HttpServer,
  path: '/ws',
});

// 处理 WebSocket 连接
wss.on('connection', (ws, request: IncomingMessage) => {
  wsHandler.handleConnection(ws, request.url);
});

// 处理 WebSocket 服务器错误
wss.on('error', (error) => {
  console.error('[Server] WebSocket 服务器错误:', error);
});

console.log('[Server] MyTermux Server 已启动');
console.log(`[Server] HTTP: http://${hostname}:${port}`);
console.log(`[Server] WebSocket: ws://${hostname}:${port}/ws`);
console.log(`[Server] 健康检查: http://${hostname}:${port}/health`);

// 优雅关闭处理
function gracefulShutdown(signal: string): void {
  console.log(`\n[Server] 收到 ${signal} 信号，正在关闭服务器...`);

  // 停止清理定时器
  deviceRegistry.stopCleanupTimer();

  // 关闭所有 WebSocket 连接
  wss.clients.forEach((client) => {
    client.close(1001, '服务器关闭');
  });

  // 关闭 WebSocket 服务器
  wss.close(() => {
    console.log('[Server] WebSocket 服务器已关闭');
  });

  // 关闭 HTTP 服务器
  httpServer.close(() => {
    console.log('[Server] HTTP 服务器已关闭');
    process.exit(0);
  });

  // 强制退出超时
  setTimeout(() => {
    console.error('[Server] 强制退出');
    process.exit(1);
  }, 10000);
}

// 注册信号处理
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 导出供测试使用
const messageRouter = runtime.messageRouter;
export { app, wss, deviceRegistry, messageRouter, wsHandler };
