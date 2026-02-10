#!/usr/bin/env node
/**
 * @mycc/daemon CLI 入口
 *
 * 命令：
 * - mycc start  启动守护进程
 * - mycc stop   停止守护进程
 * - mycc status 查看状态
 * - mycc token  查看 Access Token
 */

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { Daemon } from './daemon.js';
import { readAccessToken } from './pairing.js';

// ============================================================================
// 常量定义
// ============================================================================

/** 配置目录 */
const CONFIG_DIR = path.join(os.homedir(), '.mycc');

/** 认证数据文件路径（沿用 pairing.json 文件名，保持向后兼容） */
const AUTH_DATA_FILE = path.join(CONFIG_DIR, 'pairing.json');

/** Token 脱敏显示：保留前缀 mycc-(5字符) + 前 4 位 hex + ... + 后 4 位 hex，共需至少 13 字符 */
function maskToken(token: string): string {
  if (token.length <= 13) return token;
  return `${token.slice(0, 9)}...${token.slice(-4)}`;
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

// ============================================================================
// CLI 命令实现
// ============================================================================

const program = new Command();

program
  .name('mycc')
  .description('MyCC - 远程控制 Claude Code 守护进程')
  .version('0.1.0');

/**
 * start 命令 - 启动守护进程
 */
program
  .command('start')
  .description('启动守护进程')
  .option('-r, --relay <url>', '中继服务器地址', process.env['RELAY_URL'] || 'ws://localhost:3000')
  .option('-f, --foreground', '前台运行（不作为守护进程）', false)
  .action(async (options: { relay: string; foreground: boolean }) => {
    // 检查是否已有进程在运行
    const existingPid = await readPidFile();
    if (existingPid && isProcessRunning(existingPid)) {
      console.log(`守护进程已在运行 (PID: ${existingPid})`);
      return;
    }

    // 后台模式：fork 子进程并立即退出父进程
    if (!options.foreground) {
      const scriptPath = fileURLToPath(import.meta.url);
      const args = ['start', '-f', '-r', options.relay];
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
            const content = await fs.readFile(AUTH_DATA_FILE, 'utf-8');
            const data = JSON.parse(content) as { accessToken?: string };
            if (data.accessToken) {
              console.log(`Access Token: ${maskToken(data.accessToken)}`);
            }
          } catch (readErr) {
            // I7: 区分文件不存在（正常情况）和其他错误
            if ((readErr as NodeJS.ErrnoException).code === 'ENOENT') {
              console.log('提示: 运行 pnpm --filter @mycc/daemon token 获取 Access Token');
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
    console.log(`启动守护进程，连接到中继服务器: ${options.relay}`);

    const daemon = new Daemon({
      relayUrl: options.relay,
    });

    // 设置事件监听
    daemon.on('started', () => {
      console.log('守护进程已启动');
    });

    daemon.on('connected', () => {
      console.log('已连接到中继服务器');
    });

    daemon.on('disconnected', () => {
      console.log('与中继服务器断开连接');
    });

    daemon.on('accessToken', (token) => {
      console.log(`\nAccess Token 已更新: ${maskToken(token)}\n`);
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
      console.log(`\nAccess Token: ${maskToken(token)}`);
      console.log('客户端使用此 Token 连接 daemon\n');

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
    }
  });

/**
 * token 命令 - 查看 Access Token
 */
program
  .command('token')
  .description('查看 Access Token')
  .action(async () => {
    try {
      // I12: 复用 pairing.ts 的 readAccessToken，消除重复迁移逻辑
      const { token, migrated } = await readAccessToken();
      console.log(`Access Token: ${token}`);
      if (migrated) {
        console.log('(已自动升级旧版配置文件)');
      }

      // 检查 daemon 是否在运行
      const pid = await readPidFile();
      if (!pid || !isProcessRunning(pid)) {
        console.log('\n注意: 守护进程未在运行，请先执行 mycc start');
      }
    } catch (error) {
      // I11: 简化 ENOENT 检查
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log('未找到配置文件，请先启动守护进程 (mycc start)');
      } else {
        console.error('读取配置文件失败:', error instanceof Error ? error.message : error);
      }
    }
  });

program.parse();
