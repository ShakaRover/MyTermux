# MyTermux

MyTermux 是面向终端场景的 **Web 远程终端**，当前按两端服务拆分：

- `server`：内置托管 Web 管理界面 + 设备中继 + daemon profile 管理 + ws-ticket 签发 + Web 认证 API
- `daemon`：终端会话执行与 `MYTERMUX_DAEMON_TOKEN` 管理

## 职责与数据库边界

- Web（浏览器）：本地数据库（IndexedDB，库名 `mytermux_web_db`）
  - 仅存储快捷键等本地偏好
- Server：`~/.mytermux/relay.db`
  - 仅存储 daemon profile（含加密后的 daemon token）
- WebAuth：`~/.mytermux/web.db`
  - 存储 Web 管理端账号哈希与登录会话（Cookie 会话）
- Daemon：`~/.mytermux/daemon.db`
  - 存储 daemon 设备身份、`MYTERMUX_DAEMON_TOKEN`、已认证客户端列表
  - 启动时会自动尝试从旧 `~/.mytermux/auth.json` 迁移

## Token 约定

- `MYTERMUX_DAEMON_LINK_TOKEN`：Daemon 连接 Server 的链路授权 token（Server 配置）
- `MYTERMUX_DAEMON_TOKEN`：Web 控制 Daemon 的业务授权 token（Daemon 配置）

## 当前架构

- Web 登录：服务端 `web.db` 账号体系（默认 `admin` / `mytermux`，首次登录必须修改）
- Server 管理 API：提供 `/api/web-auth/*`、daemon/profile/ws-ticket
- Server API 鉴权：依赖 Web 登录会话（HttpOnly Cookie）
- WebSocket 准入：`/api/ws-ticket` 一次性 ticket（60 秒）
- Web 前端托管：Server 根路径 `/` 直接返回 `packages/web/dist` 静态页面

## Monorepo

- `packages/shared`: 协议、类型、加密
- `packages/server`: Server HTTP/API + WebSocket
- `packages/daemon`: 守护进程与终端会话管理
- `packages/web`: Web 管理中心与终端 UI

## 快速开始（本地）

本地运行/联调/测试统一走**无证书模型**：

- Web + Server: `http://127.0.0.1:62200`
- Server WebSocket: `ws://127.0.0.1:62200/ws`
- Daemon 本地状态监听: `http://127.0.0.1:62300`

```bash
pnpm install
pnpm turbo run build
cp .env.example .env
# 编辑 .env，至少填写:
# MYTERMUX_DAEMON_LINK_TOKEN
# SERVER_MASTER_KEY
# WEB_ADMIN_USERNAME / WEB_ADMIN_PASSWORD（可选，首次初始化账号）
```

启动本地联调：

```bash
pnpm start:local:test
```

分服务脚本（每个服务 3 个）：

```bash
# server（推荐）
bash ./scripts/server/start-fg.sh
bash ./scripts/server/start-bg.sh
bash ./scripts/server/stop.sh

# daemon
bash ./scripts/daemon/start-fg.sh
bash ./scripts/daemon/start-bg.sh
bash ./scripts/daemon/stop.sh
```

Daemon token 管理脚本：

```bash
# 获取完整 MYTERMUX_DAEMON_TOKEN
bash ./scripts/daemon/get-token.sh

# 重置 MYTERMUX_DAEMON_TOKEN（会清空已认证客户端）
bash ./scripts/daemon/reset-token.sh

# 设置 daemon -> Server 链路 token（持久化到 daemon.db）
bash ./scripts/daemon/set-server-token.sh <token>

# 清空已保存链路 token
bash ./scripts/daemon/set-server-token.sh --clear
```

浏览器打开 `http://127.0.0.1:62200`：

1. 用默认账号 `admin` / `mytermux` 登录
2. 首次登录必须先修改账号密码
3. 在 `/daemons` 选择在线 daemon profile
4. 点击连接并进入会话

## 常用命令

```bash
pnpm turbo run build
pnpm turbo run typecheck
pnpm turbo run test
pnpm turbo run clean

# server 管理快捷命令（推荐）
pnpm server:start:fg
pnpm server:start:bg
pnpm server:stop

# daemon token 管理快捷命令
pnpm daemon:token:get
pnpm daemon:token:reset
pnpm daemon:server-token:set -- <token>
```

## 运行时文件

默认目录：`~/.mytermux`

- daemon: `daemon.db`, `daemon.pid`, `daemon.status`, `daemon.log`
- server: `relay.db`, `web.db`, `relay.pid`, `relay.log`
- web(浏览器): IndexedDB（`mytermux_web_db`，仅偏好配置）

## 重要说明

- 不保留旧“Web 直接输入 daemon token 登录”流程
- 不自动迁移或删除历史版本目录
- 生产部署必须通过 Nginx 反向代理并启用证书（HTTPS/WSS）
