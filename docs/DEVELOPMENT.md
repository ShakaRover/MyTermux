# MyTermux 开发文档

## 1. 当前产品模型

MyTermux 已切换为：

- Web 独立登录（非 daemon token 直登）
- 登录后管理 daemon profile 并连接
- 单活 daemon 连接模型（支持快速切换）
- 终端会话仅 `terminal`

## 2. 核心链路

1. Relay 提供 Web Auth、Daemon 管理 API、ws-ticket、WebSocket 中继
2. Daemon 向 Relay 注册并提供 Access Token
3. Web 登录后创建/编辑 profile，申请 ws-ticket，连接 daemon
4. 应用层会话消息走 E2E 加密

## 3. 目录结构

```text
packages/
  shared/   协议与类型（SessionInfo.pid / startupCommand 等）
  relay/    API + WS + SQLite（web_sessions/login_attempts/daemon_profiles/web_preferences）
  daemon/   终端会话与 token 管理
  web/      /login /daemons /dashboard 页面与状态管理
```

## 4. 本地开发

```bash
pnpm install
pnpm turbo run build
```

启动：

```bash
pnpm --filter @mytermux/relay start:fg
pnpm --filter @mytermux/daemon start:fg
pnpm --filter @mytermux/web dev
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

- 登录问题：检查 `RELAY_ADMIN_*`、`RELAY_WEB_MASTER_KEY`、`relay.db`
- ws 连接问题：先看 `/api/ws-ticket` 再看 `/ws` 日志
- daemon 连接问题：检查 profile token、daemon 在线状态与绑定关系
