# MyTermux

MyTermux 是面向终端场景的 **Web 远程终端**：

- daemon 运行在目标主机，负责创建终端会话
- relay 负责设备中继、Web 登录认证与 daemon 管理 API
- web 登录后管理 daemon profile，并通过 ws-ticket 连接会话

Token 约定：

- `MYTERMUX_WEB_TOKEN`：Web 登录授权 token
- `MYTERMUX_WEB_LINK_TOKEN`：Web 前端申请 Relay 会话前置 token
- `MYTERMUX_DAEMON_LINK_TOKEN`：Daemon 连接 Relay 前置 token
- `MYTERMUX_DAEMON_TOKEN`：Web 控制 Daemon 的业务授权 token

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

本地运行/联调/测试统一走**无证书模型**：

- Web Client: `http://127.0.0.1:62100`
- Relay: `http://127.0.0.1:62200`
- Relay WebSocket: `ws://127.0.0.1:62200/ws`
- Daemon 本地状态监听: `http://127.0.0.1:62300`
- 不配置 `TLS_CERT` / `TLS_KEY`
- 不启用 `VITE_HTTPS`

```bash
pnpm install
pnpm turbo run build
```

1. 复制环境变量样本并填写

```bash
cp .env.example .env
# 编辑 .env，至少填写:
# MYTERMUX_WEB_TOKEN
# MYTERMUX_WEB_LINK_TOKEN
# MYTERMUX_DAEMON_LINK_TOKEN
# RELAY_WEB_MASTER_KEY
```

兼容模式（不用 `MYTERMUX_WEB_TOKEN`，改用用户名密码）：

```bash
# 写入 .env
RELAY_ADMIN_USERNAME=admin
RELAY_ADMIN_PASSWORD_HASH='<scrypt-hash>'
```

2. 启动本地测试（会同时启动 relay + daemon + web）

```bash
pnpm start:local:test
```

如需分别启动：

```bash
bash ./scripts/relay/start-fg.sh
bash ./scripts/daemon/start-fg.sh
bash ./scripts/web/start-fg.sh
```

分服务脚本（每个服务 3 个）：

```bash
# relay
bash ./scripts/relay/start-fg.sh
bash ./scripts/relay/start-bg.sh
bash ./scripts/relay/stop.sh

# daemon
bash ./scripts/daemon/start-fg.sh
bash ./scripts/daemon/start-bg.sh
bash ./scripts/daemon/stop.sh

# web
bash ./scripts/web/start-fg.sh
bash ./scripts/web/start-bg.sh
bash ./scripts/web/stop.sh
```

3. 打开 `http://127.0.0.1:62100`

4. 登录 Web 管理中心后：
- 在线 daemon 自动生成 profile，可编辑配置（token、默认目录、默认命令）
- 离线 profile 会保留，支持手动删除
- 点击“连接”进入会话页面

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

默认目录：`~/.mytermux`

- daemon: `auth.json`, `daemon.pid`, `daemon.status`
- relay: `relay.pid`, `relay.log`, `relay.db`

## 重要说明

- 不保留旧“Web 直接输入 daemon token 登录”流程
- 不自动迁移或删除历史版本目录
- 生产部署必须通过 Nginx 反向代理并启用证书（HTTPS/WSS）
