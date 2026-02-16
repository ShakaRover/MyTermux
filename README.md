# OpenTermux

OpenTermux 是一个面向终端场景的 **Web 远程终端** 项目：
你在本地运行 daemon，浏览器通过 relay 进行安全连接，在 Web 中实时操作本地终端会话。

- 项目定位：Web 远程终端
- 认证方式：Access Token（`opentermux-<32hex>`）
- 协议模型：`token_auth` / `token_ack` + E2E 加密应用消息
- 会话模型：仅 `terminal`

仓库地址：`<repository-url>`

## 核心能力

- Token 认证连接 daemon
- 浏览器端终端会话创建、输入、输出、关闭
- WebSocket 双向通信与心跳
- ECDH + AES-GCM 端到端加密
- 多客户端复用同一 daemon Access Token

## Monorepo 结构

- `packages/shared`：协议、类型、加密工具
- `packages/relay`：中继服务（HTTP + WebSocket）
- `packages/daemon`：本地守护进程（终端会话管理）
- `packages/web`：Web 前端

## 环境要求

- Node.js >= 20
- pnpm >= 9

## 快速开始（本地开发）

```bash
pnpm install
pnpm turbo run build
```

1. 启动 relay：

```bash
pnpm --filter @opentermux/relay start:fg
```

2. 启动 daemon：

```bash
pnpm --filter @opentermux/daemon start:fg
```

3. 获取完整 Access Token（如需）：

```bash
pnpm --filter @opentermux/daemon token
```

4. 启动 Web：

```bash
pnpm --filter @opentermux/web dev
```

5. 打开浏览器 `http://localhost:5173`，输入 Access Token 完成认证。

## 常用命令

```bash
# 全量构建
pnpm turbo run build

# 类型检查
pnpm turbo run typecheck

# 测试
pnpm turbo run test

# 清理
pnpm turbo run clean
```

## 运行时文件

- daemon/relay 运行目录：`~/.opentermux`
- daemon 认证文件：`~/.opentermux/auth.json`
- daemon PID：`~/.opentermux/daemon.pid`
- relay PID：`~/.opentermux/relay.pid`

## Breaking 变更说明

- 包作用域统一为 `@opentermux/*`
- CLI 统一为 `opentermux` 与 `opentermux-relay`
- Token 前缀统一为 `opentermux-`
- 本地目录统一为 `~/.opentermux`
- 认证文件统一为 `auth.json`
- Web 仅保留 `/auth` 认证入口
- 会话模型统一为 `terminal`

## 历史目录处理

本版本不会自动迁移或删除历史版本目录，请按需手动处理旧数据。
