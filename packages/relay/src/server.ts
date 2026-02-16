/**
 * Hono 服务器配置
 *
 * 功能：
 * - HTTP: GET /health 健康检查
 * - WebSocket 升级: GET /ws
 * - 集成 ws 库处理 WebSocket
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { DeviceRegistry } from './device-registry';

/** 服务器选项 */
export interface ServerOptions {
  /** 设备注册管理器（用于健康检查统计） */
  deviceRegistry?: DeviceRegistry;
}

/**
 * 创建 Hono 应用
 *
 * @param options 服务器选项
 * @returns Hono 应用实例
 */
export function createServer(options: ServerOptions = {}) {
  const app = new Hono();

  // 中间件
  app.use('*', cors());

  // 健康检查
  app.get('/health', (c) => {
    const stats = options.deviceRegistry?.getStats();

    return c.json({
      status: 'ok',
      timestamp: Date.now(),
      version: '1.0.0',
      connections: stats ?? { daemons: 0, clients: 0, accessTokens: 0 },
    });
  });

  // WebSocket 升级端点
  // 实际的 WebSocket 处理由 ws 库在 HTTP 服务器层处理
  // 这个端点仅用于非 WebSocket 请求时返回提示
  app.get('/ws', (c) => {
    // 非 WebSocket 请求返回提示
    // WebSocket 升级请求会被 ws 库在 HTTP 服务器层拦截处理
    return c.text('WebSocket endpoint - upgrade required', 426);
  });

  // API 文档/信息
  app.get('/', (c) => {
    return c.json({
      name: 'OpenTermux Relay Server',
      version: '1.0.0',
      endpoints: {
        '/health': 'GET - 健康检查',
        '/ws': 'WebSocket - 设备连接端点',
      },
    });
  });

  return app;
}
