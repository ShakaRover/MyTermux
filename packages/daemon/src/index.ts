#!/usr/bin/env node
/**
 * @mycc/daemon CLI 入口
 *
 * 命令：
 * - mycc start  启动守护进程
 * - mycc stop   停止守护进程
 * - mycc status 查看状态
 * - mycc pair   重新生成配对码
 */

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Daemon } from './daemon.js';

// ============================================================================
// 常量定义
// ============================================================================

/** 配置目录 */
const CONFIG_DIR = path.join(os.homedir(), '.mycc');

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
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  } catch {
    // 目录可能已存在
  }
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
  .option('-r, --relay <url>', '中继服务器地址', 'ws://localhost:3000')
  .option('-f, --foreground', '前台运行（不作为守护进程）', false)
  .action(async (options: { relay: string; foreground: boolean }) => {
    // 检查是否已有进程在运行
    const existingPid = await readPidFile();
    if (existingPid && isProcessRunning(existingPid)) {
      console.log(`守护进程已在运行 (PID: ${existingPid})`);
      return;
    }

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

    daemon.on('pairingCode', (code, expiresAt) => {
      const expiresIn = Math.round((expiresAt - Date.now()) / 1000);
      console.log(`\n配对码: ${code}`);
      console.log(`有效期: ${expiresIn} 秒\n`);
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

      // 生成初始配对码
      const { code, expiresAt } = daemon.generatePairingCode();
      const expiresIn = Math.round((expiresAt - Date.now()) / 1000);
      console.log(`\n配对码: ${code}`);
      console.log(`有效期: ${expiresIn} 秒\n`);

      // 更新状态文件
      const updateStatus = async (): Promise<void> => {
        await writeStatusFile(daemon.getStatus());
      };
      await updateStatus();

      // 定期更新状态文件
      setInterval(() => { void updateStatus(); }, 5000);

      if (options.foreground) {
        console.log('守护进程正在前台运行，按 Ctrl+C 停止');
      }
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
      console.log(`已配对客户端: ${status['pairedClientsCount'] ?? 0}`);
    }
  });

/**
 * pair 命令 - 生成新的配对码
 */
program
  .command('pair')
  .description('重新生成配对码')
  .action(async () => {
    const pid = await readPidFile();

    if (!pid || !isProcessRunning(pid)) {
      console.log('守护进程未在运行，请先启动守护进程');
      return;
    }

    // 由于无法直接与运行中的 daemon 通信，
    // 这里提示用户查看守护进程的输出
    console.log('请查看守护进程的控制台输出以获取新的配对码');
    console.log('提示: 使用 "mycc start -f" 在前台运行可以直接查看配对码');
  });

program.parse();
