# MyCC - 远程控制 Claude Code 实现计划

## 项目定位

通过 Web 界面随时随地查看和控制本地电脑上的 Claude Code 和终端会话。

**核心特点：**

- 本地运行 `mycc` 守护进程，Token 授权，持久可用
- 管理多个 Claude Code 实例 + 多个终端实例
- Web 端可新建/切换/关闭任意会话
- 端到端加密，中继服务器不解密内容

## 架构概览

```text
┌────────────────────────────────────────────────────────────────────────┐
│                      本地电脑 (mycc daemon 常驻)                        │
│                                                                        │
│   Session Manager                                                      │
│   ┌──────────────┐ ┌──────────────┐ ┌─────────┐ ┌─────────┐          │
│   │ Claude #1    │ │ Claude #2    │ │ Term #1 │ │ Term #2 │          │
│   │ (项目 A)     │ │ (项目 B)     │ │ (bash)  │ │ (zsh)   │          │
│   └──────────────┘ └──────────────┘ └─────────┘ └─────────┘          │
│                          │                                             │
│                   WebSocket Client (持久连接)                          │
└──────────────────────────┼─────────────────────────────────────────────┘
                           │ WSS + E2E 加密
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     中继服务器 (自托管 VPS)                            │
│  设备注册 · Token 验证 · 消息路由转发(不解密) · 离线队列                 │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ WSS + E2E 加密
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Web 前端 (React PWA)                             │
│  [会话列表]              │  [会话交互区]                               │
│   🤖 Claude: 项目A      │   现代聊天 UI / xterm.js 终端               │
│   🤖 Claude: 项目B      │   权限审批 · 消息输入                        │
│   💻 Terminal #1        │                                             │
│  [+ 新建Claude] [+ 终端] │                                             │
└──────────────────────────────────────────────────────────────────────┘
```

## 技术栈

| 组件 | 技术 | 说明 |
| ---- | ---- | ---- |
| Monorepo | pnpm workspaces + Turborepo | 统一管理多包 |
| 本地守护进程 | Node.js + TypeScript + node-pty | Daemon 模式运行 |
| 中继服务器 | Hono + @hono/node-server + ws | 轻量 HTTP + WebSocket |
| Web 前端 | React 19 + Vite + Tailwind CSS 4 + shadcn/ui | 现代聊天风格 |
| 终端渲染 | xterm.js | Web 端终端模拟 |
| 状态管理 | Zustand | 轻量状态 |
| 加密 | Web Crypto API (ECDH + AES-256-GCM) | 端到端加密 |
| PWA | vite-plugin-pwa | 移动端友好 |

## 项目结构

```text
mycc/
├── packages/
│   ├── shared/                    # 共享代码
│   │   └── src/
│   │       ├── protocol.ts        # 消息协议定义
│   │       ├── crypto.ts          # E2E 加密模块
│   │       └── types.ts           # 公共类型
│   │
│   ├── daemon/                    # 本地守护进程
│   │   └── src/
│   │       ├── index.ts           # CLI 入口 (mycc start/stop/status)
│   │       ├── daemon.ts          # Daemon 主进程
│   │       ├── session-manager.ts # 会话管理 (Claude + Terminal)
│   │       ├── claude-session.ts  # Claude Code 会话封装
│   │       ├── terminal-session.ts# 普通终端会话封装
│   │       ├── ws-client.ts       # 与中继的 WebSocket 连接
│   │       └── pairing.ts         # Token 认证管理
│   │
│   ├── relay/                     # 中继服务器
│   │   └── src/
│   │       ├── index.ts           # 服务入口
│   │       ├── server.ts          # Hono 路由 + WS
│   │       ├── device-registry.ts # 设备注册管理
│   │       └── message-router.ts  # 消息路由
│   │
│   └── web/                       # Web 前端
│       └── src/
│           ├── App.tsx
│           ├── pages/
│           │   ├── PairingPage.tsx     # Token 认证页
│           │   ├── DashboardPage.tsx   # 会话仪表盘
│           │   └── SessionPage.tsx     # 会话交互界面
│           ├── components/
│           │   ├── SessionList.tsx     # 会话列表
│           │   ├── ChatView.tsx        # Claude 对话视图
│           │   ├── TerminalView.tsx    # 终端视图 (xterm.js)
│           │   ├── MessageBubble.tsx   # 消息气泡
│           │   ├── ToolUseBlock.tsx    # 工具调用展示
│           │   ├── PermissionDialog.tsx# 权限审批
│           │   ├── NewSessionDialog.tsx# 新建会话对话框
│           │   └── ConnectionStatus.tsx# 连接状态
│           ├── hooks/
│           │   ├── useWebSocket.ts
│           │   ├── useEncryption.ts
│           │   └── useSessions.ts
│           └── stores/
│               ├── sessionsStore.ts    # 多会话状态
│               └── connectionStore.ts
│
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

## 实施步骤

### 阶段 1: 项目骨架搭建

1. **初始化 Monorepo**
   - `pnpm init`, `pnpm-workspace.yaml`, `turbo.json`
   - 根 `tsconfig.base.json` + 各包 `tsconfig.json`
   - 配置 `shared`、`daemon`、`relay`、`web` 四个包

2. **shared 包 - 协议与类型**
   - `types.ts`: 会话类型（`ClaudeSession | TerminalSession`）、消息类型、权限请求类型
   - `protocol.ts`: 传输层 + 应用层协议（含会话管理指令：create/list/close/input/output）
   - `crypto.ts`: 暂时留占位符，阶段 4 实现

### 阶段 2: 本地守护进程

3. **Daemon 主进程** (`daemon/src/daemon.ts`)
   - Daemon 模式运行（后台常驻，不阻塞终端）
   - 维护与中继服务器的持久 WebSocket 连接
   - 管理所有子会话的生命周期

4. **CLI 入口** (`daemon/src/index.ts`)
   - `mycc start` — 启动守护进程（显示 Access Token）
   - `mycc stop` — 停止守护进程
   - `mycc status` — 查看运行状态和活跃会话
   - `mycc token` — 查看 Access Token

5. **Claude 会话** (`daemon/src/claude-session.ts`)
   - 使用 `node-pty` 启动 `claude` 子进程
   - 捕获终端输出流（保留 ANSI 格式）
   - 提供 `sendInput(text)` 写入 stdin
   - 检测权限提示（正则匹配审批 prompt）
   - 支持指定项目路径、模型参数等

6. **终端会话** (`daemon/src/terminal-session.ts`)
   - 使用 `node-pty` 启动 shell 进程（bash/zsh）
   - 捕获完整终端输出（含 ANSI 转义序列）
   - 支持发送任意输入
   - 支持调整终端尺寸（rows/cols）

7. **会话管理器** (`daemon/src/session-manager.ts`)
   - 统一管理所有 Claude + Terminal 会话
   - `createSession(type, options)` — 创建会话
   - `listSessions()` — 列出所有活跃会话
   - `closeSession(id)` — 关闭指定会话
   - 会话输出事件 → 加密 → 通过 WebSocket 发送到中继

8. **WebSocket 客户端** (`daemon/src/ws-client.ts`)
   - 持久连接中继服务器，自动重连（指数退避）
   - 注册为 `daemon` 类型设备
   - 接收远程指令 → 解密 → 分发到对应会话
   - 会话输出 → 加密 → 发送到中继

### 阶段 3: 中继服务器

9. **Hono 服务器** (`relay/src/server.ts`)
   - HTTP: `GET /health`
   - WebSocket 升级: `GET /ws`

10. **设备注册** (`relay/src/device-registry.ts`)
    - `Map<deviceId, WebSocket>` 设备连接表
    - `Map<accessToken, daemonId>` Token 注册表
    - 认证流程：Web 发送 Access Token → 中继验证 → 绑定 daemon ↔ client
    - 心跳检测 + 自动清理

11. **消息路由** (`relay/src/message-router.ts`)
    - daemon → client: 会话输出、会话列表更新、权限请求
    - client → daemon: 创建会话、发送输入、审批权限、关闭会话
    - 只转发，不解密

### 阶段 4: E2E 加密

12. **加密模块** (`shared/src/crypto.ts`)
    - `generateKeyPair()`: ECDH P-256
    - `deriveSharedSecret()`: 密钥交换
    - `encrypt()` / `decrypt()`: AES-256-GCM，每条消息随机 IV
    - 配对时交换公钥，后续所有通信使用共享密钥

### 阶段 5: Web 前端

13. **项目初始化**: Vite + React 19 + Tailwind 4 + shadcn/ui + React Router

14. **认证页** (`PairingPage.tsx`)
    - 输入 Access Token（格式：`mycc-<32hex>`）
    - ECDH 密钥交换
    - 认证成功后凭证存 localStorage

15. **仪表盘** (`DashboardPage.tsx`)
    - 左侧会话列表 + 右侧交互区
    - `+ 新建 Claude` / `+ 新建终端` 按钮
    - 响应式：移动端标签切换

16. **Claude 对话视图** (`ChatView.tsx`)
    - 现代聊天气泡 UI
    - Markdown + 代码高亮 (react-markdown + shiki)
    - 工具调用折叠展示
    - 权限审批弹窗
    - 底部输入框

17. **终端视图** (`TerminalView.tsx`)
    - xterm.js 渲染完整终端
    - 键盘输入转发
    - 尺寸自适应

18. **WebSocket + 状态**: useWebSocket hook + Zustand sessionsStore

### 阶段 6: 集成与完善

19. **端到端验证**
    - `mycc start` → Token 认证 → Web 新建 Claude → 对话 → 权限审批
    - Web 新建终端 → 执行命令 → 查看输出

20. **稳定性**: 断线重连、进程崩溃检测、错误通知

## 消息协议

### 传输层（中继可见）

```typescript
{ type: "register"|"token_auth"|"token_ack"|"message"|"heartbeat"|"error", from: string, to?: string, payload: string /*加密*/ }
```

### 应用层（E2E 加密内容）

```typescript
// 会话管理指令
{ action: "session:create", type: "claude"|"terminal", options: { cwd?, model? } }
{ action: "session:list" }
{ action: "session:close", sessionId: string }

// 会话交互
{ action: "session:input", sessionId: string, data: string }
{ action: "session:output", sessionId: string, data: string }
{ action: "session:resize", sessionId: string, cols: number, rows: number }

// 权限审批
{ action: "permission:request", sessionId: string, id: string, tool: string, desc: string }
{ action: "permission:respond", sessionId: string, id: string, approved: boolean }
```

---

## 开发模式：Superpowers + Swarm 协作

本项目采用 **Superpowers 技能系统** + **Swarm 多代理协作** 的开发模式，确保高质量交付。

### 已安装的工具链

| 类别 | 工具 | 用途 |
| ---- | ---- | ---- |
| **代码审查** | `/review`, `pr-review-toolkit`, `code-review` | 多维度代码审查（质量、安全、性能） |
| **测试** | `playwright`, Vitest (待配置) | E2E 测试、单元测试 |
| **提交** | `/commit`, `commit-commands` | Conventional Commits 规范提交 |
| **LSP** | `typescript-lsp` | 类型检查、代码诊断 |
| **文档** | `context7` | 库文档检索 |
| **子代理** | `lite-task` (Haiku), `simple-task` (Sonnet) | 分层任务执行 |
| **安全** | `security-guidance` | 安全扫描 |

### 核心技能链

```text
writing-plans → executing-plans → verification-before-completion → requesting-code-review
     ↓              ↓                        ↓
  制定计划     TDD + 子代理执行          证据先于断言
```

### Swarm 团队结构

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Team Lead (主代理)                        │
│   职责：规划、任务分解、审查、协调                                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   Coder #1    │   │   Coder #2    │   │    Tester     │
│   daemon 包    │   │   relay 包    │   │   集成测试    │
└───────────────┘   └───────────────┘   └───────────────┘
        │                   │                   │
        └───────────────────┴───────────────────┘
                            │
                    共享任务列表
              ~/.claude/tasks/mycc-dev/
```

### 阶段与技能映射

| 开发阶段 | 使用的 Superpowers 技能 | Swarm 协作 |
| -------- | ----------------------- | ---------- |
| 阶段 1: 骨架搭建 | `writing-plans` | 单代理执行 |
| 阶段 2: daemon | `test-driven-development` | Coder: daemon |
| 阶段 3: relay | `subagent-driven-development` | Coder: relay（并行） |
| 阶段 4: crypto | `test-driven-development` | 单代理（shared 包） |
| 阶段 5: web | `dispatching-parallel-agents` | Coder: web（多组件并行） |
| 阶段 6: 集成 | `verification-before-completion` | Tester 代理 |
| 完成 | `requesting-code-review` | 全量审查 |

### 典型工作流

#### 1. 启动开发（Team Lead）

```text
1. 调用 /writing-plans 制定详细实施计划
2. 将计划保存到 docs/plans/YYYY-MM-DD-phase-N.md
3. TeamCreate 创建团队 "mycc-dev"
4. TaskCreate 创建原子化任务（每个 2-5 分钟）
```

#### 2. 并行开发（Swarm）

```text
1. Task 工具派发 Coder 代理（subagent_type: general-purpose）
2. 每个 Coder 代理：
   - 读取任务列表，认领未分配任务
   - 遵循 TDD：写失败测试 → 最小实现 → 验证通过
   - SendMessage 汇报进度或阻塞问题
   - TaskUpdate 标记完成
3. Team Lead 监控进度，解决阻塞
```

#### 3. 质量保障

```text
1. 每个任务完成：子代理自检
2. 批次完成：/verification-before-completion
3. 阶段完成：/requesting-code-review
4. 最终交付：全量测试 + E2E 验证
```

### 任务分解示例（阶段 2: daemon）

| Task ID | 描述 | 前置依赖 | 预估 |
| ------- | ---- | -------- | ---- |
| 2.1 | 创建 daemon 包骨架 + package.json | - | 3min |
| 2.2 | 实现 ClaudeSession 类（node-pty 包装） | 2.1 | 5min |
| 2.3 | 为 ClaudeSession 编写单元测试 | 2.2 | 3min |
| 2.4 | 实现 TerminalSession 类 | 2.1 | 4min |
| 2.5 | 实现 SessionManager | 2.2, 2.4 | 5min |
| 2.6 | 实现 CLI 入口（commander） | 2.5 | 4min |
| 2.7 | 实现 WSClient（WebSocket 连接） | 2.1 | 5min |
| 2.8 | 集成测试 daemon 模块 | 2.6, 2.7 | 5min |

### 通信协议

**子代理 → Team Lead：**

```typescript
SendMessage({
  type: "message",
  recipient: "team-lead",
  content: "任务 2.3 完成，测试全部通过",
  summary: "Task 2.3 done"
})
```

**Team Lead → 子代理：**

```typescript
SendMessage({
  type: "message",
  recipient: "coder-daemon",
  content: "请优先处理 SessionManager 的错误边界",
  summary: "Priority update"
})
```

**紧急广播（慎用）：**

```typescript
SendMessage({
  type: "broadcast",
  content: "发现 shared 包类型定义错误，所有代理暂停",
  summary: "Blocking issue"
})
```

### 验证检查点

每个阶段结束前必须通过：

1. **代码验证**：`pnpm turbo run build --filter=@mycc/*`
2. **测试验证**：`pnpm turbo run test --filter=@mycc/*`
3. **类型检查**：`pnpm turbo run typecheck`
4. **代码审查**：调用 `/requesting-code-review`

---

## 质量保障机制

### 测试策略

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           测试金字塔                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                          ┌─────────┐                                    │
│                          │  E2E    │  Playwright                        │
│                          │  Tests  │  (关键用户流程)                     │
│                        ┌─┴─────────┴─┐                                  │
│                        │ Integration │  Vitest                          │
│                        │   Tests     │  (模块间交互)                     │
│                      ┌─┴─────────────┴─┐                                │
│                      │   Unit Tests    │  Vitest                        │
│                      │                 │  (函数/类级别)                  │
│                      └─────────────────┘                                │
└─────────────────────────────────────────────────────────────────────────┘
```

| 测试类型 | 工具 | 覆盖范围 | 运行时机 |
| -------- | ---- | -------- | -------- |
| 单元测试 | Vitest | 加密模块、协议解析、会话管理 | 每次提交前 |
| 集成测试 | Vitest | daemon↔relay↔web 消息流 | 每个阶段完成 |
| E2E 测试 | Playwright | Token 认证→新建会话→对话→权限审批 | 阶段 6 |

### 代码审查流程

```text
开发完成
    │
    ▼
┌─────────────────┐
│ /review 自检    │  ← 自动触发（说"做完了"）
│ 置信度 ≥ 75%   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 修复审查意见    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ /commit 提交    │  ← lite-task 执行
│ Conventional    │
│ Commits 格式    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ PR 创建后       │
│ pr-review-toolkit│  ← 5 个并行 Sonnet 代理审查
└─────────────────┘
```

### 提交规范

采用 **Conventional Commits** 格式，通过 `/commit` 技能自动生成：

```text
<type>(<scope>): <description>

type:
  feat     新功能
  fix      Bug 修复
  refactor 重构
  test     测试
  docs     文档
  chore    构建/工具

scope:
  daemon   本地守护进程
  relay    中继服务器
  web      Web 前端
  shared   共享模块
  e2e      端到端测试

示例：
  feat(daemon): 实现 ClaudeSession 进程包装
  fix(relay): 修复心跳超时后连接未清理
  test(shared): 添加 crypto 模块加解密测试
```

### 子代理分工

| 代理 | 模型 | 适用任务 |
| ---- | ---- | -------- |
| `lite-task` | Haiku | Git 操作、简单文件修改、格式化 |
| `simple-task` | Sonnet | 小功能实现、Bug 修复、单文件重构 |
| `general-purpose` | Sonnet | 复杂功能开发、多文件修改 |
| Swarm Coder | Sonnet | 并行开发独立模块 |
| Swarm Tester | Sonnet | 集成测试、E2E 测试 |

### CI/CD 流程（本地模拟）

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                         本地 CI 检查链                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  pnpm install                                                           │
│       │                                                                 │
│       ▼                                                                 │
│  pnpm turbo run typecheck  ──────────────────┐                         │
│       │                                       │                         │
│       ▼                                       │                         │
│  pnpm turbo run lint       ──────────────────┤  任一失败 → 阻断提交     │
│       │                                       │                         │
│       ▼                                       │                         │
│  pnpm turbo run test       ──────────────────┤                         │
│       │                                       │                         │
│       ▼                                       │                         │
│  pnpm turbo run build      ──────────────────┘                         │
│       │                                                                 │
│       ▼                                                                 │
│  /review (可选的最终审查)                                               │
│       │                                                                 │
│       ▼                                                                 │
│  /commit (生成规范提交)                                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 安全检查

通过 `security-guidance` 插件，在以下场景自动触发安全扫描：

- 涉及加密模块 (`crypto.ts`) 的修改
- WebSocket 通信相关代码
- 用户输入处理逻辑
- 敏感数据存储（Access Token、加密密钥、会话凭证）

### 文档同步

- 使用 `context7` MCP 获取最新库文档（Hono、Vite、React 等）
- 代码注释与 PLAN.md 保持同步
- 每个阶段完成后更新验证清单状态

---

## 验证清单

### 功能验证

- [ ] `mycc start` 启动 daemon 并显示 Access Token
- [ ] Web 输入 Access Token 成功认证
- [ ] Web 新建 Claude 会话，本地 claude 进程启动
- [ ] Web 发消息，Claude 收到并回复，Web 实时显示
- [ ] Claude 请求权限 → Web 弹出审批框 → 批准后继续
- [ ] Web 新建终端，输入命令，输出正确显示
- [ ] Web 关闭会话，本地进程正确终止
- [ ] 断网后重连自动恢复
- [ ] `mycc status` 显示所有活跃会话
- [ ] `mycc stop` 正确关闭所有会话和 daemon

### 质量验证

- [ ] 所有单元测试通过 (`pnpm test`)
- [ ] 类型检查无错误 (`pnpm typecheck`)
- [ ] 构建成功 (`pnpm build`)
- [ ] `/review` 审查无高优先级问题
- [ ] E2E 测试通过 (Playwright)

### 安全验证

- [ ] E2E 加密正确实现（中继服务器无法解密）
- [ ] Access Token 安全生成（`mycc-<32hex>` 格式）
- [ ] 密钥安全存储（不明文保存）
- [ ] 无硬编码凭证

### 已知安全限制

- **localStorage 存储风险**：当前认证凭证（Access Token、私钥 JWK）存储在 `localStorage` 中，XSS 攻击可能导致凭证泄露。这是 Web 应用的固有限制，后续可考虑以下缓解措施：
  - 使用 `HttpOnly Cookie` + 后端 session 管理（需架构调整）
  - 对存储的私钥进行二次加密（用户 PIN 码）
  - 添加 CSP（Content Security Policy）头限制脚本来源
  - Token 过期机制（当前 Token 无过期时间）

### 性能验证

- [ ] 消息延迟 < 200ms（局域网）
- [ ] Web 首屏加载 < 2s
- [ ] 支持同时 5+ 会话
