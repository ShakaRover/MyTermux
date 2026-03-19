#!/usr/bin/env node
/**
 * @mytermux/daemon CLI 入口
 *
 * 命令：
 * - mytermux start  启动守护进程
 * - mytermux stop   停止守护进程
 * - mytermux status 查看状态
 * - mytermux token  查看/重置 MYTERMUX_DAEMON_TOKEN
 * - mytermux server-token 查看/设置 daemon -> Server 链路 token
 */

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { Daemon } from './daemon.js';
import {
  readAccessToken,
  resetAccessToken,
  readDaemonLinkToken,
  setDaemonLinkToken,
  clearDaemonLinkToken,
} from './auth-manager.js';

// ============================================================================
// 常量定义
// ============================================================================

/** 配置目录 */
const CONFIG_DIR = path.join(os.homedir(), '.mytermux');

/** Token 脱敏显示：保留前缀和前后各 4 位随机段 */
function maskToken(token: string): string {
  const dashIndex = token.indexOf('-');
  if (dashIndex === -1) {
    return token.length <= 8 ? token : `${token.slice(0, 4)}...${token.slice(-4)}`;
  }
  const prefix = token.slice(0, dashIndex + 1);
  const body = token.slice(dashIndex + 1);
  if (body.length <= 8) {
    return token;
  }
  return `${prefix}${body.slice(0, 4)}...${body.slice(-4)}`;
}

/** PID 文件路径 */
const PID_FILE = path.join(CONFIG_DIR, 'daemon.pid');

/** 状态文件路径 */
const STATUS_FILE = path.join(CONFIG_DIR, 'daemon.status');

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
 * 写入状态文件
 */
async function writeStatusFile(status: Record<string, unknown>): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
}

/**
 * 读取状态文件
 */
async function readStatusFile(): Promise<Record<string, unknown> | null> {
  try {
    const content = await fs.readFile(STATUS_FILE, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 解析 daemon -> Server 链路 token
 * 优先级：CLI 参数 > 环境变量 > daemon.db 持久化配置
 */
async function resolveDaemonLinkToken(tokenFromCli?: string): Promise<string> {
  const cliToken = tokenFromCli?.trim();
  if (cliToken) {
    return cliToken;
  }

  const envToken = process.env['MYTERMUX_DAEMON_LINK_TOKEN']?.trim();
  if (envToken) {
    return envToken;
  }

  const saved = await readDaemonLinkToken();
  return saved?.trim() || '';
}

/**
 * 解析 daemon -> Server 地址
 * 优先级：--server > 环境变量 > 默认值
 */
function resolveServerUrl(serverFromCli: string | undefined): string {
  const cliServer = serverFromCli?.trim();
  if (cliServer) {
    return cliServer;
  }
  return process.env['SERVER_URL'] || 'ws://127.0.0.1:62200';
}

// ============================================================================
// CLI 命令实现
// ============================================================================

const program = new Command();

program
  .name('mytermux')
  .description('MyTermux - 远程控制终端会话守护进程')
  .version('1.0.0');

/**
 * start 命令 - 启动守护进程
 */
program
  .command('start')
  .description('启动守护进程')
  .option('-s, --server <url>', 'Server 地址', process.env['SERVER_URL'] || 'ws://127.0.0.1:62200')
  .option('--listen-host <host>', '本地状态监听地址', process.env['DAEMON_HOST'] || '127.0.0.1')
  .option('--listen-port <port>', '本地状态监听端口', process.env['DAEMON_PORT'] || '62300')
  .option('--daemon-link-token <token>', 'daemon 连接 Server 链路 token（优先级高于环境变量与 daemon.db）')
  .option('-f, --foreground', '前台运行（不作为守护进程）', false)
  .action(async (options: {
    server?: string;
    foreground: boolean;
    daemonLinkToken?: string;
    listenHost: string;
    listenPort: string;
  }) => {
    // 检查是否已有进程在运行
    const existingPid = await readPidFile();
    if (existingPid && isProcessRunning(existingPid)) {
      console.log(`守护进程已在运行 (PID: ${existingPid})`);
      return;
    }

    const serverUrl = resolveServerUrl(options.server);
    const daemonLinkToken = await resolveDaemonLinkToken(options.daemonLinkToken);

    // 后台模式：fork 子进程并立即退出父进程
    if (!options.foreground) {
      const scriptPath = fileURLToPath(import.meta.url);
      const args = ['start', '-f', '--server', serverUrl];
      if (daemonLinkToken) {
        args.push('--daemon-link-token', daemonLinkToken);
      }
      args.push('--listen-host', options.listenHost.trim() || '127.0.0.1');
      args.push('--listen-port', options.listenPort.trim() || '62300');
      const logFile = path.join(CONFIG_DIR, 'daemon.log');

      await ensureConfigDir();

      const logFd = await fs.open(logFile, 'a');
      // I3: 确保 logFd 在 spawn 失败时也能被关闭
      try {
        const child = spawn(process.execPath, [scriptPath, ...args], {
          detached: true,
          stdio: ['ignore', logFd.fd, logFd.fd],
          env: { ...process.env },
        });

        child.unref();
      } finally {
        // logFd 需要在 spawn 之后关闭，子进程已继承该 fd
        await logFd.close();
      }

      // 等待子进程写入 PID 文件，确认启动成功
      let started = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const pid = await readPidFile();
        if (pid && isProcessRunning(pid)) {
          started = true;
          console.log(`守护进程已在后台启动 (PID: ${pid})`);

          // 读取并显示 Access Token
          try {
            const { token } = await readAccessToken();
            console.log(`MYTERMUX_DAEMON_TOKEN: ${maskToken(token)}`);
          } catch (readErr) {
            // I7: 区分文件不存在（正常情况）和其他错误
            if ((readErr as NodeJS.ErrnoException).code === 'ENOENT') {
              console.log('提示: 运行 pnpm --filter @mytermux/daemon token 获取 MYTERMUX_DAEMON_TOKEN');
            } else {
              console.warn('读取 Access Token 失败:', readErr instanceof Error ? readErr.message : readErr);
            }
          }

          console.log(`日志文件: ${logFile}`);
          break;
        }
      }

      if (!started) {
        console.error('守护进程启动超时，请检查日志:', logFile);
        process.exit(1);
      }
      return;
    }

    // 前台模式：直接在当前进程运行
    console.log(`启动守护进程，连接到 Server: ${serverUrl}`);
    const listenHost = options.listenHost.trim() || '127.0.0.1';
    const parsedListenPort = parseInt(options.listenPort, 10);
    const listenPort = Number.isFinite(parsedListenPort) ? parsedListenPort : 62300;
    console.log(`本地状态监听地址: http://${listenHost}:${listenPort}`);

    const daemon = new Daemon({
      relayUrl: serverUrl,
      listenHost,
      listenPort,
      ...(daemonLinkToken ? { daemonLinkToken } : {}),
    });

    // 设置事件监听
    daemon.on('started', () => {
      console.log('守护进程已启动');
    });

    daemon.on('connected', () => {
      console.log('已连接到 Server');
    });

    daemon.on('disconnected', () => {
      console.log('与 Server 断开连接');
    });

    daemon.on('accessToken', (token) => {
      console.log(`\nMYTERMUX_DAEMON_TOKEN 已更新: ${maskToken(token)}\n`);
    });

    daemon.on('error', (error) => {
      console.error('错误:', error.message);
    });

    // 处理进程信号
    const cleanup = async (): Promise<void> => {
      console.log('\n正在停止守护进程...');
      daemon.stop();
      await removePidFile();
      process.exit(0);
    };

    process.on('SIGINT', () => { void cleanup(); });
    process.on('SIGTERM', () => { void cleanup(); });

    try {
      await daemon.start();

      // 写入 PID 文件
      await writePidFile(process.pid);

      // 输出 Access Token
      const token = daemon.getAccessToken();
      console.log(`\nMYTERMUX_DAEMON_TOKEN: ${maskToken(token)}`);
      console.log('Web 端通过该 Token 完成 daemon 控制授权\n');

      // 更新状态文件
      const updateStatus = async (): Promise<void> => {
        await writeStatusFile(daemon.getStatus());
      };
      await updateStatus();

      // 定期更新状态文件
      setInterval(() => { void updateStatus(); }, 5000);

      console.log('守护进程正在前台运行，按 Ctrl+C 停止');
    } catch (error) {
      console.error('启动失败:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * stop 命令 - 停止守护进程
 */
program
  .command('stop')
  .description('停止守护进程')
  .action(async () => {
    const pid = await readPidFile();

    if (!pid) {
      console.log('守护进程未在运行');
      return;
    }

    if (!isProcessRunning(pid)) {
      console.log('守护进程已停止（清理旧的 PID 文件）');
      await removePidFile();
      return;
    }

    console.log(`正在停止守护进程 (PID: ${pid})...`);

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
      console.log('守护进程已停止');
    } catch (error) {
      console.error('停止失败:', error instanceof Error ? error.message : error);
    }
  });

/**
 * status 命令 - 查看状态
 */
program
  .command('status')
  .description('查看运行状态和活跃会话')
  .action(async () => {
    const pid = await readPidFile();

    if (!pid || !isProcessRunning(pid)) {
      console.log('守护进程状态: 未运行');
      await removePidFile();
      return;
    }

    const status = await readStatusFile();

    console.log('守护进程状态: 运行中');
    console.log(`PID: ${pid}`);

    if (status) {
      console.log(`连接状态: ${status['isConnected'] ? '已连接' : '未连接'}`);
      console.log(`设备 ID: ${status['deviceId'] ?? '未知'}`);
      console.log(`活跃会话: ${status['sessionCount'] ?? 0}`);
      console.log(`已认证客户端: ${status['authenticatedClientsCount'] ?? 0}`);
      if (status['listenHost'] && status['listenPort']) {
        console.log(`本地监听: http://${status['listenHost']}:${status['listenPort']}`);
      }
    }
  });

/**
 * token 命令 - 查看 MYTERMUX_DAEMON_TOKEN
 */
program
  .command('token')
  .description('查看 MYTERMUX_DAEMON_TOKEN')
  .option('--reset', '重置 token（会清空已认证客户端）', false)
  .action(async (options: { reset?: boolean }) => {
    try {
      const pid = await readPidFile();
      const running = !!pid && isProcessRunning(pid);

      if (options.reset && running) {
        console.error(`重置失败: 守护进程正在运行 (PID: ${pid})，请先执行 mytermux stop`);
        process.exit(1);
      }

      const result = options.reset
        ? await resetAccessToken()
        : await readAccessToken();
      const { token, migrated } = result;
      console.log(`MYTERMUX_DAEMON_TOKEN: ${token}`);
      if (options.reset) {
        console.log('已重置 token，并清空已认证客户端');
      }
      if (migrated) {
        console.log('(已自动升级旧版配置文件)');
      }

      // 检查 daemon 是否在运行
      if (!running) {
        console.log('\n注意: 守护进程未在运行，请先执行 mytermux start');
      }
    } catch (error) {
      // I11: 简化 ENOENT 检查
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log('未找到配置文件，请先启动守护进程 (mytermux start)');
      } else {
        console.error('读取配置文件失败:', error instanceof Error ? error.message : error);
      }
    }
  });

async function handleDaemonLinkTokenCommand(options: { set?: string; clear?: boolean }): Promise<void> {
  try {
    const nextToken = options.set?.trim() || '';
    const shouldClear = !!options.clear;

    if (nextToken && shouldClear) {
      console.error('参数冲突: --set 与 --clear 不能同时使用');
      process.exit(1);
    }

    if (nextToken) {
      await setDaemonLinkToken(nextToken);
      console.log('MYTERMUX_DAEMON_LINK_TOKEN 已保存到 daemon.db');
      console.log('注意: 若 daemon 正在运行，新配置将在下次启动时生效');
      return;
    }

    if (shouldClear) {
      await clearDaemonLinkToken();
      console.log('MYTERMUX_DAEMON_LINK_TOKEN 已清空');
      console.log('注意: 若 daemon 正在运行，新配置将在下次启动时生效');
      return;
    }

    const token = await readDaemonLinkToken();
    if (!token) {
      console.log('MYTERMUX_DAEMON_LINK_TOKEN: (未设置)');
      return;
    }

    console.log(`MYTERMUX_DAEMON_LINK_TOKEN: ${token}`);
  } catch (error) {
    console.error('server-token 操作失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * server-token 命令 - 查看/设置 daemon -> Server 链路 token
 */
program
  .command('server-token')
  .description('查看/设置 MYTERMUX_DAEMON_LINK_TOKEN（daemon -> Server 链路 token）')
  .option('-s, --set <token>', '设置新的 server token')
  .option('--clear', '清空已保存 server token', false)
  .action(async (options: { set?: string; clear?: boolean }) => {
    await handleDaemonLinkTokenCommand(options);
  });

program.parse();
