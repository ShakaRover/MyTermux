# MyCC 开发文档

## 项目概述

MyCC 是一个远程控制 Claude Code 的项目，允许用户通过 Web 界面随时随地查看和控制本地电脑上的 Claude Code 和终端会话。

## 项目架构

```
                    ┌─────────────────────────────────────────────────────┐
                    │                 本地电脑 (mycc daemon)                │
                    │                                                       │
                    │   SessionManager                                      │
                    │   ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────┐   │
                    │   │Claude #1 │ │Claude #2 │ │Term #1 │ │Term #2 │   │
                    │   └──────────┘ └──────────┘ └────────┘ └────────┘   │
                    │                      │                                │
                    │               WebSocket Client                        │
                    └──────────────────────┼────────────────────────────────┘
                                           │ WSS + E2E 加密
                                           ▼
                    ┌──────────────────────────────────────────────────────┐
                    │                   中继服务器 (relay)                   │
                    │    设备注册 · 配对管理 · 消息路由转发(不解密)           │
                    └──────────────────────┬───────────────────────────────┘
                                           │ WSS + E2E 加密
                                           ▼
                    ┌──────────────────────────────────────────────────────┐
                    │                     Web 前端                          │
                    │      会话列表 · 聊天视图 · 终端视图 · 权限审批         │
                    └──────────────────────────────────────────────────────┘
```

## 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| Monorepo | pnpm workspaces + Turborepo | 统一管理多包 |
| 本地守护进程 | Node.js + TypeScript + node-pty | Daemon 模式运行 |
| 中继服务器 | Hono + @hono/node-server + ws | 轻量 HTTP + WebSocket |
| Web 前端 | React 19 + Vite + Tailwind CSS 4 | 现代聊天风格 |
| 终端渲染 | xterm.js | Web 端终端模拟 |
| 状态管理 | Zustand | 轻量状态 |
| 加密 | Web Crypto API (ECDH + AES-256-GCM) | 端到端加密 |

## 开发环境搭建

### 前置条件

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Git

### 克隆与安装

```bash
# 克隆项目
git clone <repository-url>
cd mycc

# 安装依赖
pnpm install
```

### 开发命令

```bash
# 构建所有包
pnpm turbo run build

# 类型检查
pnpm turbo run typecheck

# 运行测试
pnpm turbo run test

# 开发模式
pnpm turbo run dev

# 清理构建产物
pnpm turbo run clean
```

## 项目结构

```
mycc/
├── packages/
│   ├── shared/                    # 共享代码
│   │   ├── src/
│   │   │   ├── types.ts           # 公共类型定义
│   │   │   ├── protocol.ts        # 消息协议定义
│   │   │   ├── crypto.ts          # E2E 加密模块
│   │   │   └── index.ts           # 导出入口
│   │   └── tests/                 # 单元测试
│   │
│   ├── daemon/                    # 本地守护进程
│   │   └── src/
│   │       ├── index.ts           # CLI 入口
│   │       ├── daemon.ts          # Daemon 主进程
│   │       ├── session-manager.ts # 会话管理器
│   │       ├── claude-session.ts  # Claude 会话封装
│   │       ├── terminal-session.ts# 终端会话封装
│   │       ├── ws-client.ts       # WebSocket 客户端
│   │       └── pairing.ts         # 配对逻辑
│   │
│   ├── relay/                     # 中继服务器
│   │   └── src/
│   │       ├── index.ts           # 服务入口
│   │       ├── server.ts          # Hono 路由
│   │       ├── device-registry.ts # 设备注册管理
│   │       ├── message-router.ts  # 消息路由
│   │       └── websocket-handler.ts# WebSocket 处理
│   │
│   └── web/                       # Web 前端
│       └── src/
│           ├── App.tsx            # 应用入口
│           ├── pages/             # 页面组件
│           ├── components/        # UI 组件
│           ├── hooks/             # 自定义 Hooks
│           └── stores/            # Zustand 状态
│
├── docs/                          # 文档
├── package.json                   # 根配置
├── pnpm-workspace.yaml            # 工作空间配置
├── turbo.json                     # Turborepo 配置
└── tsconfig.base.json             # TypeScript 基础配置
```

## 模块间通信

### 1. Daemon ↔ Relay

使用 WebSocket 长连接，支持自动重连。

**连接流程：**
1. Daemon 连接到 Relay WebSocket 端点
2. 发送 `register` 消息注册为 daemon 类型设备
3. 维持心跳保持连接

### 2. Web ↔ Relay

同样使用 WebSocket 长连接。

**配对流程：**
1. Web 连接并注册为 client 类型设备
2. 用户输入 6 位配对码
3. 发送 `pair` 消息请求配对
4. Relay 验证配对码并建立绑定
5. 交换公钥，派生共享密钥

### 3. 消息加密

所有应用层消息使用 AES-256-GCM 加密：

```typescript
// 加密
const encrypted = await encryptJson(sharedKey, message);

// 解密
const decrypted = await decryptJson<AppMessage>(sharedKey, encrypted);
```

## 代码规范

### TypeScript 配置

- 严格模式启用
- `exactOptionalPropertyTypes: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`

### 命名约定

- **文件名**: kebab-case (如 `session-manager.ts`)
- **类名**: PascalCase (如 `SessionManager`)
- **函数名**: camelCase (如 `createSession`)
- **常量**: UPPER_SNAKE_CASE (如 `PAIRING_CODE_TTL`)

### 注释语言

代码注释使用中文，与项目代码库保持一致。

## 调试技巧

### 1. Daemon 调试

```bash
# 前台运行，查看完整日志
cd packages/daemon
pnpm build
node dist/index.js start -f
```

### 2. Relay 调试

```bash
# 启动 relay 服务器
cd packages/relay
pnpm build
pnpm start
```

### 3. Web 调试

```bash
# 开发模式，支持热更新
cd packages/web
pnpm dev
```

### 4. 全栈调试

在三个终端分别运行：
1. `pnpm --filter @mycc/relay start`
2. `pnpm --filter @mycc/daemon start -- start -f`
3. `pnpm --filter @mycc/web dev`

## 常见问题

### Q: 类型检查失败 `Cannot find name 'CryptoKey'`

确保 tsconfig.json 包含 DOM 库：
```json
{
  "compilerOptions": {
    "lib": ["ES2022", "DOM"]
  }
}
```

### Q: node-pty 编译失败

node-pty 需要编译原生模块，确保安装了：
- Windows: Visual Studio Build Tools
- macOS: Xcode Command Line Tools
- Linux: build-essential, python3

### Q: WebSocket 连接失败

1. 确保 Relay 服务器已启动
2. 检查防火墙设置
3. 检查 URL 是否正确（包括端口）

## 扩展开发

### 添加新的会话类型

1. 在 `shared/src/types.ts` 添加类型定义
2. 在 `daemon/src/` 创建新的会话类
3. 在 `SessionManager` 中添加创建逻辑
4. 在 `web/src/components/` 添加对应视图

### 添加新的消息类型

1. 在 `shared/src/protocol.ts` 定义消息接口
2. 在 `daemon/src/daemon.ts` 添加处理逻辑
3. 在 `web/src/hooks/` 添加发送逻辑
