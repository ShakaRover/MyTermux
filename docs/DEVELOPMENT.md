# OpenTermux 开发文档

## 项目定位

OpenTermux 是 Web 远程终端系统，核心链路：

1. daemon 在本地创建终端会话
2. relay 负责 WebSocket 转发与 Token 认证
3. web 通过 Access Token 连接 daemon，操作终端

## 仓库结构

```text
.
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   │   ├── types.ts
│   │   │   ├── protocol.ts
│   │   │   └── crypto.ts
│   ├── relay/
│   │   ├── src/
│   │   │   ├── cli.ts
│   │   │   ├── server.ts
│   │   │   ├── device-registry.ts
│   │   │   ├── message-router.ts
│   │   │   └── websocket-handler.ts
│   ├── daemon/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── daemon.ts
│   │   │   ├── auth-manager.ts
│   │   │   ├── session-manager.ts
│   │   │   ├── terminal-session.ts
│   │   │   └── ws-client.ts
│   └── web/
│       ├── src/
│       │   ├── App.tsx
│       │   ├── pages/AuthPage.tsx
│       │   ├── pages/DashboardPage.tsx
│       │   ├── hooks/useWebSocket.ts
│       │   ├── hooks/useSessions.ts
│       │   ├── stores/connectionStore.ts
│       │   └── stores/sessionsStore.ts
├── docs/
└── turbo.json
```

## 本地开发

```bash
pnpm install
pnpm turbo run build
```

### 启动 relay

```bash
pnpm --filter @opentermux/relay start:fg
```

### 启动 daemon

```bash
pnpm --filter @opentermux/daemon start:fg
```

### 启动 web

```bash
pnpm --filter @opentermux/web dev
```

## 协议原则

- 传输层仅负责路由与认证协作
- 应用层消息默认 E2E 加密
- 当前仅支持 `terminal` 会话类型

参考：`docs/API.md`

## 代码约定

- 包依赖统一使用 `@opentermux/*`
- CLI 统一：`opentermux` / `opentermux-relay`
- 认证术语统一使用 `auth`
- 存储目录统一 `~/.opentermux`

## 常见开发命令

```bash
# 类型检查
pnpm turbo run typecheck

# 测试
pnpm turbo run test

# 构建
pnpm turbo run build

# 清理
pnpm turbo run clean
```

## 调试建议

- relay 连接问题：优先看 `GET /health` 与 relay 日志
- daemon 认证问题：检查 `~/.opentermux/auth.json` 与 `opentermux token`
- web 认证问题：清理本地 `opentermux:auth_token` 后重试
