# MyTermux 开发文档

## 1. 当前产品模型

MyTermux 已切换为：

- Web 独立登录（非 daemon token 直登）
- 登录后管理 daemon profile 并连接
- 单活 daemon 连接模型（支持快速切换）
- 终端会话仅 `terminal`

## 2. 核心链路

1. Relay 提供 Web Auth、Daemon 管理 API、ws-ticket、WebSocket 中继
2. Daemon 向 Relay 注册并提供 `MYTERMUX_DAEMON_TOKEN`
3. Web 首次登录默认账号 `admin` / `mytermux` 后必须先修改账号密码；随后按在线 daemon 自动生成 profile，并可在 Web 端配置 Relay 地址与 Web Link Token
4. 应用层会话消息走 E2E 加密

Token 定义：

- `MYTERMUX_WEB_LINK_TOKEN`：Web -> Relay 链接前置 token（Relay 配置）
- `MYTERMUX_DAEMON_LINK_TOKEN`：Daemon -> Relay 链接前置 token（Relay 配置）
- `MYTERMUX_DAEMON_TOKEN`：Web 控制 Daemon 的业务授权 token（Daemon 配置）

## 3. 目录结构

```text
packages/
  shared/   协议与类型（SessionInfo.pid / startupCommand 等）
  relay/    API + WS + SQLite（web_sessions/login_attempts/daemon_profiles/web_preferences）
  daemon/   终端会话与 token 管理
  web/      /login /daemons /sessions 页面与状态管理
```

## 4. 本地开发

约束：本地开发与联调统一无证书模型（HTTP + WS），不要配置 `TLS_CERT` / `TLS_KEY`，不要启用 `VITE_HTTPS`。

```bash
pnpm install
pnpm turbo run build
cp .env.example .env
# 编辑 .env（至少填写 MYTERMUX_WEB_LINK_TOKEN / MYTERMUX_DAEMON_LINK_TOKEN / RELAY_WEB_MASTER_KEY）
```

启动：

```bash
pnpm start:local:test
```

默认地址：

- Web Client: `http://127.0.0.1:62100`
- Relay: `http://127.0.0.1:62200`
- Relay WebSocket: `ws://127.0.0.1:62200/ws`
- Daemon 本地状态监听: `http://127.0.0.1:62300`

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

## 5. 协议与类型关键点

- `SessionType = 'terminal'`
- `SessionInfo.pid?: number`
- `TerminalSessionOptions.startupCommand?: string`
- WebSocket client 必须先拿 `ws-ticket`

## 6. 代码约定

- 包作用域：`@mytermux/*`
- CLI：`mytermux` / `mytermux-relay`
- 术语：统一使用 `auth`（不再使用 `pairing`）
- 运行目录：`~/.mytermux`

## 7. 常用命令

```bash
pnpm turbo run typecheck
pnpm turbo run test
pnpm turbo run build
pnpm turbo run clean
```

## 8. 调试建议

- 登录问题：默认账号密码为 `admin` / `mytermux`；首次登录必须先修改账号和密码，再执行其他管理操作
- ws 连接问题：先看 `/api/ws-ticket` 再看 `/ws` 日志
- daemon 连接问题：检查 `MYTERMUX_DAEMON_LINK_TOKEN`、`MYTERMUX_DAEMON_TOKEN` 与 daemon 在线状态
