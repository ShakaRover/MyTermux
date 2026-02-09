# MyCC - 远程控制 Claude Code

MyCC 是一个允许你通过 Web 界面随时随地查看和控制本地电脑上 Claude Code 和终端会话的工具。

## 特性

- **多会话管理** - 同时运行多个 Claude Code 和终端会话
- **端到端加密** - 所有通信使用 ECDH + AES-256-GCM 加密
- **现代 Web UI** - 类似 ChatGPT/Claude.ai 的聊天界面
- **完整终端支持** - xterm.js 渲染真实终端体验
- **权限审批** - 远程批准或拒绝 Claude 的敏感操作
- **自托管** - 完全控制你的数据和基础设施

## 架构

```
┌─────────────────────────────────┐
│         本地电脑                 │
│  mycc daemon                    │
│  ├── Claude Session #1          │
│  ├── Claude Session #2          │
│  ├── Terminal Session #1        │
│  └── Terminal Session #2        │
└──────────────┬──────────────────┘
               │ WSS + E2E 加密
               ▼
┌─────────────────────────────────┐
│       中继服务器 (VPS)           │
│  设备注册 · 配对 · 消息路由      │
└──────────────┬──────────────────┘
               │ WSS + E2E 加密
               ▼
┌─────────────────────────────────┐
│         Web 前端                 │
│  会话管理 · 聊天视图 · 终端视图   │
└─────────────────────────────────┘
```

## 快速开始

### 前置条件

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Claude CLI（需要单独安装）

### 安装

```bash
# 克隆项目
git clone <repository-url>
cd mycc

# 安装依赖
pnpm install

# 构建
pnpm turbo run build
```

### 运行

**1. 启动中继服务器**
```bash
pnpm --filter @mycc/relay start
```

**2. 启动守护进程**
```bash
pnpm --filter @mycc/daemon start -- start -f
```

**3. 启动 Web 界面**
```bash
pnpm --filter @mycc/web dev
```

**4. 打开浏览器访问 http://localhost:5173，输入配对码完成配对**

## 项目结构

```
mycc/
├── packages/
│   ├── shared/     # 共享类型、协议、加密模块
│   ├── daemon/     # 本地守护进程
│   ├── relay/      # 中继服务器
│   └── web/        # Web 前端
├── docs/           # 文档
└── ...
```

## 文档

- [开发文档](docs/DEVELOPMENT.md) - 开发环境搭建、架构说明、代码规范
- [测试文档](docs/TESTING.md) - 测试策略、运行测试、编写测试
- [使用文档](docs/USER_GUIDE.md) - 快速开始、功能说明、故障排除
- [部署文档](docs/DEPLOYMENT.md) - VPS 部署、Docker、安全配置
- [API 文档](docs/API.md) - 消息协议、API 端点、错误码

## 技术栈

| 组件 | 技术 |
|------|------|
| Monorepo | pnpm workspaces + Turborepo |
| 守护进程 | Node.js + TypeScript + node-pty |
| 中继服务器 | Hono + @hono/node-server + ws |
| Web 前端 | React 19 + Vite + Tailwind CSS 4 |
| 终端渲染 | xterm.js |
| 状态管理 | Zustand |
| 加密 | Web Crypto API (ECDH P-256 + AES-256-GCM) |

## 开发

```bash
# 类型检查
pnpm turbo run typecheck

# 运行测试
pnpm turbo run test

# 开发模式
pnpm turbo run dev

# 清理
pnpm turbo run clean
```

## 安全

- 所有消息使用端到端加密
- 中继服务器无法解密消息内容
- 配对码有效期 5 分钟
- 建议生产环境使用 HTTPS/WSS

## 贡献

欢迎贡献！请阅读 [开发文档](docs/DEVELOPMENT.md) 了解如何参与开发。

## 许可证

MIT License
