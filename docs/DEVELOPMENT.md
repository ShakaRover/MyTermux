# MyTermux 开发文档

## 1. 当前产品模型

MyTermux 当前职责边界：

- Server（实现包：`packages/server`）：内置托管 Web UI、中继、profile 管理 API、WebAuth API
- Daemon：终端会话执行与 daemon token 管理

## 2. 数据边界（必须遵守）

1. Web 浏览器本地数据库仅保存偏好（IndexedDB：`mytermux_web_db`）
2. Server 只写 `relay.db`（daemon profile）
3. WebAuth 只写 `web.db`（Web 账号与会话）
4. Daemon 只写 `daemon.db`（设备身份/token/已认证客户端）

禁止跨项目混用数据库。

## 3. 核心链路

1. Web 调用 `/api/web-auth/*` 登录（默认 `admin` / `mytermux`，首次登录强制改密）
2. Web 读取本地偏好配置，调用 Server 管理 API（依赖登录 Cookie 会话）
3. Server 按在线 daemon 自动生成 profile，并签发 ws-ticket
4. Web 用 ws-ticket 连接 Server，Server 路由到 Daemon
5. 应用层会话消息走 E2E 加密

## 4. Token 定义

- `MYTERMUX_DAEMON_LINK_TOKEN`：Daemon -> Server 链路鉴权（Server 配置）
- `MYTERMUX_DAEMON_TOKEN`：Web 控制 Daemon 的业务授权 token（Daemon 配置）

## 5. 目录结构

```text
packages/
  shared/   协议与类型（SessionInfo.pid / startupCommand 等）
  server/   API + WS + SQLite（daemon_profiles）+ Web 静态托管
  daemon/   终端会话与 daemon.db 持久化
  web/      前端源码（构建产物由 server 托管）
```

## 6. 本地开发

约束：本地开发与联调统一无证书模型（HTTP + WS），不要配置 `TLS_CERT` / `TLS_KEY`，不要启用 `VITE_HTTPS`。

```bash
pnpm install
pnpm turbo run build
cp .env.example .env
# 编辑 .env（至少填写 MYTERMUX_DAEMON_LINK_TOKEN / SERVER_MASTER_KEY）
# 可选：WEB_ADMIN_USERNAME / WEB_ADMIN_PASSWORD（仅首次初始化 web.db 时生效）
```

启动：

```bash
pnpm start:local:test
```

默认地址：

- Web + Server: `http://127.0.0.1:62200`
- Server WebSocket: `ws://127.0.0.1:62200/ws`
- Daemon 本地状态监听: `http://127.0.0.1:62300`

## 7. 常用命令

```bash
pnpm turbo run typecheck
pnpm turbo run test
pnpm turbo run build
pnpm turbo run clean

# server
pnpm server:start:fg
pnpm server:start:bg
pnpm server:stop

# daemon token / server-token
pnpm --filter @mytermux/daemon token
pnpm --filter @mytermux/daemon token -- --reset
pnpm --filter @mytermux/daemon server-token
pnpm --filter @mytermux/daemon server-token -- --set '<daemon-link-token>'
pnpm --filter @mytermux/daemon server-token -- --clear
```

## 8. 调试建议

- Web 登录问题：
  - 先确认 Server 进程可访问 `/api/web-auth/session`
  - 检查 `~/.mytermux/web.db` 是否可读写
  - 默认账号为 `admin` / `mytermux`，首次登录必须先改账号密码
- Server 管理 API 401：
  - 先检查是否已登录，且 Cookie 会话未过期
- Daemon token 问题：
  - 检查 `~/.mytermux/daemon.db`
  - 必要时执行 `mytermux token --reset` 重置 token（需先停止 daemon）
  - 如 Server 开启链路鉴权，执行 `mytermux server-token --set '<daemon-link-token>'`
