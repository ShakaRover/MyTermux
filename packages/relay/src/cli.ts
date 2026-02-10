#!/usr/bin/env node
/**
 * @mycc/relay CLI 入口
 *
 * 命令：
 * - relay start      启动中继服务器（后台）
 * - relay start -f   前台运行
 * - relay stop       停止中继服务器
 * - relay status     查看状态
 */

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// ============================================================================
// 常量定义
// ============================================================================

/** 配置目录 */
const CONFIG_DIR = path.join(os.homedir(), '.mycc');

/** PID 文件路径 */
const PID_FILE = path.join(CONFIG_DIR, 'relay.pid');

/** 日志文件路径 */
const LOG_FILE = path.join(CONFIG_DIR, 'relay.log');

/** 默认端口 */
const DEFAULT_PORT = 3000;

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 确保配置目录存在
 */
async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

/**
 * 读取 PID 文件
 */
async function readPidFile(): Promise<number | null> {
  try {
    const content = await fs.readFile(PID_FILE, 'utf-8');
    return parseInt(content.trim(), 10);
  } catch {
    return null;
  }
}

/**
 * 写入 PID 文件
 */
async function writePidFile(pid: number): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(PID_FILE, pid.toString(), 'utf-8');
}

/**
 * 删除 PID 文件
 */
async function removePidFile(): Promise<void> {
  try {
    await fs.unlink(PID_FILE);
  } catch {
    // 文件可能不存在
  }
}

/**
 * 检查进程是否存在
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 通过健康检查获取服务器状态
 */
async function fetchHealthStatus(port: number): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`http://localhost:${port}/health`);
    if (response.ok) {
      return await response.json() as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 通过端口查找监听该端口的进程 PID（Linux/macOS）
 * 只查找 LISTEN 状态的进程，避免误匹配客户端连接
 */
async function findPidByPort(port: number): Promise<number | null> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  try {
    // lsof -iTCP:<port> -sTCP:LISTEN -t  只查找 LISTEN 状态的进程
    const { stdout } = await execFileAsync('lsof', [
      `-iTCP:${port}`, '-sTCP:LISTEN', '-t',
    ]);
    const pids = stdout.trim().split('\n').filter(Boolean).map(Number);
    return pids[0] ?? null;
  } catch {
    try {
      // 备选：fuser（Linux）
      const { stdout } = await execFileAsync('fuser', [`${port}/tcp`]);
      const pid = parseInt(stdout.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }
}

/**
 * 停止指定 PID 的进程
 */
async function stopProcess(pid: number): Promise<void> {
  console.log(`正在停止中继服务器 (PID: ${pid})...`);

  try {
    process.kill(pid, 'SIGTERM');

    // 等待进程退出
    let attempts = 0;
    while (isProcessRunning(pid) && attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }

    if (isProcessRunning(pid)) {
      console.log('进程未响应，强制终止...');
      process.kill(pid, 'SIGKILL');
    }

    await removePidFile();
    console.log('中继服务器已停止');
  } catch (error) {
    console.error('停止失败:', error instanceof Error ? error.message : error);
  }
}

// ============================================================================
// CLI 命令实现
// ============================================================================

const program = new Command();

program
  .name('mycc-relay')
  .description('MyCC Relay Server - 中继服务器管理')
  .version('0.1.0');

/**
 * start 命令 - 启动中继服务器
 */
program
  .command('start')
  .description('启动中继服务器')
  .option('-p, --port <port>', '监听端口', String(DEFAULT_PORT))
  .option('-f, --foreground', '前台运行（不作为后台进程）', false)
  .action(async (options: { port: string; foreground: boolean }) => {
    const port = parseInt(options.port, 10);

    // 检查是否已有进程在运行
    const existingPid = await readPidFile();
    if (existingPid && isProcessRunning(existingPid)) {
      console.log(`中继服务器已在运行 (PID: ${existingPid})`);
      return;
    }

    // 没有 PID 文件，通过端口检测是否已有服务在运行
    const health = await fetchHealthStatus(port);
    if (health) {
      const portPid = await findPidByPort(port);
      console.log(`端口 ${port} 已被占用${portPid ? ` (PID: ${portPid})` : ''}，中继服务器可能已在运行`);
      console.log('如需重启，请先执行 stop 命令');
      return;
    }

    // 后台模式：fork 子进程并立即退出父进程
    if (!options.foreground) {
      const scriptPath = fileURLToPath(import.meta.url);
      const args = ['start', '-f', '-p', String(port)];

      await ensureConfigDir();

      const logFd = await fs.open(LOG_FILE, 'a');
      const child = spawn(process.execPath, [scriptPath, ...args], {
        detached: true,
        stdio: ['ignore', logFd.fd, logFd.fd],
        env: { ...process.env, PORT: String(port) },
      });

      child.unref();
      // logFd 需要在 spawn 之后关闭，子进程已继承该 fd
      await logFd.close();

      // 等待子进程写入 PID 文件，确认启动成功
      let started = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const pid = await readPidFile();
        if (pid && isProcessRunning(pid)) {
          started = true;
          console.log(`中继服务器已在后台启动 (PID: ${pid})`);
          console.log(`HTTP: http://localhost:${port}`);
          console.log(`WebSocket: ws://localhost:${port}/ws`);
          console.log(`日志文件: ${LOG_FILE}`);
          break;
        }
      }

      if (!started) {
        console.error('中继服务器启动超时，请检查日志:', LOG_FILE);
        process.exit(1);
      }
      return;
    }

    // 前台模式：直接在当前进程运行服务器
    // 设置端口环境变量
    process.env['PORT'] = String(port);

    // 动态导入服务器启动逻辑
    const { serve } = await import('@hono/node-server');
    const { WebSocketServer } = await import('ws');
    const { createServer } = await import('./server.js');
    const { DeviceRegistry } = await import('./device-registry.js');
    const { MessageRouter } = await import('./message-router.js');
    const { WebSocketHandler } = await import('./websocket-handler.js');

    // 初始化核心组件
    const deviceRegistry = new DeviceRegistry();
    const messageRouter = new MessageRouter(deviceRegistry);
    const wsHandler = new WebSocketHandler(deviceRegistry, messageRouter);

    // 创建 Hono 应用
    const app = createServer({ deviceRegistry });

    console.log(`[Relay] MyCC Relay Server 启动中，端口: ${port}...`);

    // 启动 HTTP 服务器
    const httpServer = serve({
      fetch: app.fetch,
      port,
    });

    // 创建 WebSocket 服务器
    const wss = new WebSocketServer({
      server: httpServer as unknown as import('node:http').Server,
      path: '/ws',
    });

    // 处理 WebSocket 连接
    wss.on('connection', (ws) => {
      wsHandler.handleConnection(ws);
    });

    wss.on('error', (error) => {
      console.error('[Relay] WebSocket 服务器错误:', error);
    });

    // 写入 PID 文件
    await writePidFile(process.pid);

    console.log(`[Relay] MyCC Relay Server 已启动`);
    console.log(`[Relay] HTTP: http://localhost:${port}`);
    console.log(`[Relay] WebSocket: ws://localhost:${port}/ws`);
    console.log(`[Relay] 健康检查: http://localhost:${port}/health`);
    console.log('[Relay] 中继服务器正在前台运行，按 Ctrl+C 停止');

    // 优雅关闭处理
    const cleanup = async (signal: string): Promise<void> => {
      console.log(`\n[Relay] 收到 ${signal} 信号，正在关闭服务器...`);

      // 停止清理定时器
      deviceRegistry.stopCleanupTimer();

      // 删除 PID 文件
      await removePidFile();

      let wssClosed = false;
      let httpClosed = false;

      const tryExit = (): void => {
        if (wssClosed && httpClosed) {
          console.log('[Relay] 服务器已完全关闭');
          process.exit(0);
        }
      };

      // 关闭所有 WebSocket 连接
      wss.clients.forEach((client) => {
        client.close(1001, '服务器关闭');
      });

      // 关闭 WebSocket 服务器
      wss.close(() => {
        console.log('[Relay] WebSocket 服务器已关闭');
        wssClosed = true;
        tryExit();
      });

      // 关闭 HTTP 服务器
      httpServer.close(() => {
        console.log('[Relay] HTTP 服务器已关闭');
        httpClosed = true;
        tryExit();
      });

      // 强制退出超时
      setTimeout(() => {
        console.error('[Relay] 关闭超时，强制退出');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGINT', () => { void cleanup('SIGINT'); });
    process.on('SIGTERM', () => { void cleanup('SIGTERM'); });
  });

/**
 * stop 命令 - 停止中继服务器
 */
program
  .command('stop')
  .description('停止中继服务器')
  .option('-p, --port <port>', '服务器端口（用于查找进程）', String(DEFAULT_PORT))
  .action(async (options: { port: string }) => {
    const port = parseInt(options.port, 10);
    const pid = await readPidFile();

    if (pid && isProcessRunning(pid)) {
      await stopProcess(pid);
      return;
    }

    if (pid) {
      console.log('中继服务器已停止（清理旧的 PID 文件）');
      await removePidFile();
      return;
    }

    // 没有 PID 文件，尝试通过端口查找进程
    const portPid = await findPidByPort(port);
    if (portPid) {
      console.log(`未找到 PID 文件，通过端口 ${port} 找到进程`);
      await stopProcess(portPid);
      return;
    }

    console.log('中继服务器未在运行');
  });

/**
 * status 命令 - 查看状态
 */
program
  .command('status')
  .description('查看中继服务器运行状态')
  .option('-p, --port <port>', '服务器端口（用于健康检查）', String(DEFAULT_PORT))
  .action(async (options: { port: string }) => {
    const port = parseInt(options.port, 10);
    let pid = await readPidFile();

    // 没有 PID 文件时，通过健康检查 + 端口查找
    if (!pid || !isProcessRunning(pid)) {
      await removePidFile();

      // 尝试健康检查看服务是否在运行
      const health = await fetchHealthStatus(port);
      if (health) {
        // 服务在运行但没有 PID 文件，通过端口查找 PID
        pid = await findPidByPort(port);
        if (pid) {
          console.log('中继服务器状态: 运行中（无 PID 文件）');
          console.log(`PID: ${pid}`);
        } else {
          console.log('中继服务器状态: 运行中');
        }
        console.log(`端口: ${port}`);
        const connections = health['connections'] as Record<string, number> | undefined;
        if (connections) {
          console.log(`已连接 Daemon: ${connections['daemons'] ?? 0}`);
          console.log(`已连接客户端: ${connections['clients'] ?? 0}`);
          console.log(`已注册 Token: ${connections['accessTokens'] ?? 0}`);
        }
        return;
      }

      console.log('中继服务器状态: 未运行');
      return;
    }

    console.log('中继服务器状态: 运行中');
    console.log(`PID: ${pid}`);

    // 通过健康检查获取详细状态
    const health = await fetchHealthStatus(port);
    if (health) {
      console.log(`端口: ${port}`);
      const connections = health['connections'] as Record<string, number> | undefined;
      if (connections) {
        console.log(`已连接 Daemon: ${connections['daemons'] ?? 0}`);
        console.log(`已连接客户端: ${connections['clients'] ?? 0}`);
        console.log(`已注册 Token: ${connections['accessTokens'] ?? 0}`);
      }
    } else {
      console.log(`端口: ${port} (健康检查无响应)`);
    }
  });

program.parse();
