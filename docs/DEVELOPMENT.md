# MyTermux 开发文档

## 1. 当前产品模型

MyTermux 当前职责边界：

- Web：本地登录与管理 UI（不走 Relay 登录）
- Relay：中继与 profile 管理 API
- Daemon：终端会话执行与 daemon token 管理

## 2. 数据边界（必须遵守）

1. Web 只写浏览器本地数据库（IndexedDB：`mytermux_web_db`）
2. Relay 只写 `relay.db`（daemon profile）
3. Daemon 只写 `daemon.db`（设备身份/token/已认证客户端）

禁止跨项目混用数据库。

## 3. 核心链路

1. Web 本地账号登录（默认 `admin` / `mytermux`，首次登录强制改密）
2. Web 读取本地配置，调用 Relay 管理 API（必要时携带 `x-mytermux-web-link-token`）
3. Relay 按在线 daemon 自动生成 profile，并签发 ws-ticket
4. Web 用 ws-ticket 连接 Relay，Relay 路由到 Daemon
5. 应用层会话消息走 E2E 加密

## 4. Token 定义

- `MYTERMUX_WEB_LINK_TOKEN`：Web -> Relay 管理 API 与 ws-ticket 鉴权（Relay 配置）
- `MYTERMUX_DAEMON_LINK_TOKEN`：Daemon -> Relay 链路鉴权（Relay 配置）
- `MYTERMUX_DAEMON_TOKEN`：Web 控制 Daemon 的业务授权 token（Daemon 配置）

## 5. 目录结构

```text
packages/
  shared/   协议与类型（SessionInfo.pid / startupCommand 等）
  relay/    API + WS + SQLite（daemon_profiles）
  daemon/   终端会话与 daemon.db 持久化
  web/      /login /daemons /sessions 页面与本地数据库状态管理
```

## 6. 本地开发

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

## 7. 常用命令

```bash
pnpm turbo run typecheck
pnpm turbo run test
pnpm turbo run build
pnpm turbo run clean

# daemon token / relay-token
pnpm --filter @mytermux/daemon token
pnpm --filter @mytermux/daemon token -- --reset
pnpm --filter @mytermux/daemon relay-token
pnpm --filter @mytermux/daemon relay-token -- --set '<daemon-link-token>'
pnpm --filter @mytermux/daemon relay-token -- --clear
```

## 8. 调试建议

- Web 登录问题：
  - 先确认浏览器本地数据库是否被清理
  - 默认账号为 `admin` / `mytermux`
  - 首次登录必须先改账号密码
- Relay 管理 API 401：
  - 优先检查 `MYTERMUX_WEB_LINK_TOKEN` 与 `x-mytermux-web-link-token` 是否一致
- Daemon token 问题：
  - 检查 `~/.mytermux/daemon.db`
  - 必要时执行 `mytermux token --reset` 重置 token（需先停止 daemon）
  - 如 Relay 开启链路鉴权，执行 `mytermux relay-token --set '<daemon-link-token>'`
