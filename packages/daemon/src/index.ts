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

const program = new Command();

program
  .name('mycc')
  .description('MyCC - 远程控制 Claude Code 守护进程')
  .version('0.1.0');

program
  .command('start')
  .description('启动守护进程')
  .option('-r, --relay <url>', '中继服务器地址', 'ws://localhost:3000')
  .action(async (options: { relay: string }) => {
    console.log(`启动守护进程，连接到中继服务器: ${options.relay}`);
    // TODO: 实现启动逻辑
  });

program
  .command('stop')
  .description('停止守护进程')
  .action(async () => {
    console.log('停止守护进程');
    // TODO: 实现停止逻辑
  });

program
  .command('status')
  .description('查看运行状态和活跃会话')
  .action(async () => {
    console.log('查看状态');
    // TODO: 实现状态查看逻辑
  });

program
  .command('pair')
  .description('重新生成配对码')
  .action(async () => {
    console.log('生成新的配对码');
    // TODO: 实现配对码生成逻辑
  });

program.parse();
