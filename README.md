# OpenTermux

OpenTermux 是面向终端场景的 **Web 远程终端**：

- daemon 运行在目标主机，负责创建终端会话
- relay 负责设备中继、Web 登录认证与 daemon 管理 API
- web 登录后管理 daemon profile，并通过 ws-ticket 连接会话

仓库地址：`<repository-url>`

## 当前架构

- Web 登录：`HttpOnly Cookie + CSRF`
- 防暴力破解：IP 限流 + 账号/IP 递增锁定（持久化到 SQLite）
- Daemon 管理：在线 daemon 与已保存 profile 聚合视图
- WebSocket 准入：`/api/ws-ticket` 一次性 ticket（60 秒）
- 会话模型：仅 `terminal`
- 会话信息：支持返回 `pid`
- 默认启动命令：支持 `startupCommand`（zsh/bash/tmux/custom）

## Monorepo

- `packages/shared`: 协议、类型、加密
- `packages/relay`: Relay HTTP/API + WebSocket
- `packages/daemon`: 守护进程与终端会话管理
- `packages/web`: Web 管理中心与终端 UI

## 快速开始（本地）

```bash
pnpm install
pnpm turbo run build
```

1. 启动 relay（建议先配置管理员环境变量）

```bash
pnpm --filter @opentermux/relay start:fg
```

2. 启动 daemon

```bash
pnpm --filter @opentermux/daemon start:fg
```

3. 启动 Web

```bash
pnpm --filter @opentermux/web dev
```

4. 打开 `http://localhost:5173`

5. 登录 Web 管理中心后：
- 新建/编辑 daemon profile（含 token、默认目录、默认命令）
- 绑定在线 daemon
- 点击“连接”进入 Dashboard

## 常用命令

```bash
# 构建
pnpm turbo run build

# 类型检查
pnpm turbo run typecheck

# 测试
pnpm turbo run test

# 清理
pnpm turbo run clean
```

## 运行时文件

默认目录：`~/.opentermux`

- daemon: `auth.json`, `daemon.pid`, `daemon.status`
- relay: `relay.pid`, `relay.log`, `relay.db`

## 重要说明

- 不保留旧“Web 直接输入 daemon token 登录”流程
- 不自动迁移或删除历史版本目录
