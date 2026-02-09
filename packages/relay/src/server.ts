/**
 * Hono 服务器配置
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

export function createServer() {
  const app = new Hono();

  // 中间件
  app.use('*', cors());

  // 健康检查
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      timestamp: Date.now(),
      version: '0.1.0',
    });
  });

  // WebSocket 升级将在后续实现
  app.get('/ws', (c) => {
    return c.text('WebSocket endpoint - upgrade required', 426);
  });

  return app;
}
