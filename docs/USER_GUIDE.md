# MyCC 使用文档

## 简介

MyCC 是一个远程控制 Claude Code 的工具，允许你通过 Web 界面随时随地查看和控制本地电脑上的 Claude Code 和终端会话。

## 快速开始

### 第一步：安装依赖

确保已安装：
- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Claude CLI（需要单独安装）

### 第二步：安装 MyCC

```bash
# 克隆项目
git clone <repository-url>
cd mycc

# 安装依赖
pnpm install

# 构建所有包
pnpm turbo run build
```

### 第三步：启动中继服务器

运行：

```bash
# 后台运行（推荐，命令执行后立即返回）
pnpm --filter @mycc/relay start

# 或前台运行（用于调试，输出实时日志）
pnpm --filter @mycc/relay start:fg
```

你会看到：

```text
中继服务器已在后台启动 (PID: 12345)
HTTP: http://localhost:3000
WebSocket: ws://localhost:3000/ws
日志文件: ~/.mycc/relay.log
```

### 第四步：启动守护进程

在另一个终端中运行：

```bash
# 后台运行（推荐，命令执行后立即返回）
pnpm --filter @mycc/daemon start

# 或前台运行（用于调试，输出实时日志）
pnpm --filter @mycc/daemon start:fg
```

你会看到 Access Token：
```
守护进程已在后台启动 (PID: 12345)
Access Token: mycc-a1b2c3d4e5f6...
日志文件: ~/.mycc/daemon.log
```

### 第五步：启动 Web 界面

在第三个终端中运行：

```bash
pnpm --filter @mycc/web dev
```

打开浏览器访问 `http://localhost:5173`

### 第六步：认证

1. 在 Web 界面输入守护进程显示的 Access Token
2. 点击"连接 Daemon"按钮
3. 认证成功后自动跳转到仪表盘

### 停止服务

使用完毕后，按以下顺序停止各组件（顺序不强制，但推荐按此操作）：

#### 1. 停止守护进程

```bash
# 使用 pnpm
pnpm --filter @mycc/daemon stop

# 或使用 mycc 命令
mycc stop
```

守护进程会优雅关闭所有活跃的 Claude 和终端会话，断开与中继的连接后退出。

#### 2. 停止中继服务器

```bash
# 使用 pnpm
pnpm --filter @mycc/relay stop

# 或使用 mycc-relay 命令
mycc-relay stop
```

中继服务器会关闭所有 WebSocket 连接并退出。

> 前台运行（`-f`）模式下，也可以直接按 `Ctrl+C` 停止。

#### 3. 停止 Web 开发服务器

在运行 Web 的终端中按 `Ctrl+C`。

## 守护进程命令

在项目根目录下，你可以使用 pnpm 命令来管理各模块。基本格式为：
`pnpm --filter <package-name> <command> [-- <args>]`

### 使用 pnpm 运行

```bash
# 后台启动（作为守护进程运行，推荐）
pnpm --filter @mycc/daemon start

# 前台启动（终端可见输出，适合调试）
pnpm --filter @mycc/daemon start:fg

# 停止守护进程
pnpm --filter @mycc/daemon stop

# 查看运行状态
pnpm --filter @mycc/daemon status

# 查看 Access Token
pnpm --filter @mycc/daemon token
```

如果已将 daemon 全局安装，也可以使用 `mycc` 命令：

### 启动守护进程

```bash
mycc start [选项]

选项：
  -r, --relay <url>   中继服务器地址 (默认: ws://localhost:3000)
  -f, --foreground    前台运行，不作为守护进程
```

**示例：**
```bash
# 前台运行，连接本地中继
mycc start -f

# 连接远程中继服务器
mycc start -r wss://relay.example.com
```

### 停止守护进程

```bash
mycc stop
```

守护进程会优雅关闭：先关闭所有活跃会话（Claude 和终端子进程），断开与中继的 WebSocket 连接，最后退出。如果 3 秒内未响应，将被强制终止。

> 前台运行（`-f`）模式下，也可以直接按 `Ctrl+C` 停止。

### 查看状态

```bash
mycc status
```

输出示例：
```
守护进程状态: 运行中
PID: 12345
连接状态: 已连接
设备 ID: abc123def456
活跃会话: 3
已认证客户端: 1
```

### 查看 Access Token

```bash
# 使用 pnpm
pnpm --filter @mycc/daemon token

# 或使用 mycc 命令
mycc token
```

## 中继服务器命令

### 使用 pnpm 管理中继

```bash
# 后台启动（推荐）
pnpm --filter @mycc/relay start

# 前台启动（终端可见输出，适合调试）
pnpm --filter @mycc/relay start:fg

# 停止中继服务器
pnpm --filter @mycc/relay stop

# 查看运行状态
pnpm --filter @mycc/relay status
```

如果已将 relay 全局安装，也可以使用 `mycc-relay` 命令：

### 启动中继服务器

```bash
mycc-relay start [选项]

选项：
  -p, --port <port>   监听端口 (默认: 3000)
  -H, --host <host>   监听地址 (默认: 0.0.0.0)
  --cert <path>       TLS 证书文件路径（启用 HTTPS/WSS）
  --key <path>        TLS 私钥文件路径（启用 HTTPS/WSS）
  -f, --foreground     前台运行，不作为后台进程
```

**示例：**

```bash
# 后台运行，使用默认端口
mycc-relay start

# 前台运行，指定端口
mycc-relay start -f -p 8080

# 指定监听地址和端口
mycc-relay start -H 0.0.0.0 -p 8080
```

### 停止中继服务器

```bash
mycc-relay stop
```

中继服务器会关闭所有 WebSocket 连接后退出。如果 10 秒内未响应，将被强制终止。

> 前台运行（`-f`）模式下，也可以直接按 `Ctrl+C` 停止。

### 查看中继状态

```bash
mycc-relay status
```

输出示例：

```text
中继服务器状态: 运行中
PID: 12345
端口: 3000
已连接 Daemon: 1
已连接客户端: 2
已注册 Token: 1
```

## Web 界面使用

### 仪表盘

仪表盘分为左右两栏：
- **左栏**：会话列表，显示所有 Claude 和终端会话
- **右栏**：会话交互区，显示选中会话的内容

### 创建会话

#### 创建 Claude 会话

1. 点击会话列表顶部的 "+ Claude" 按钮
2. 可选：设置工作目录、模型参数
3. 点击"创建"

#### 创建终端会话

1. 点击会话列表顶部的 "+ 终端" 按钮
2. 可选：设置工作目录、shell 类型
3. 点击"创建"

### 会话交互

#### Claude 会话

- 在底部输入框输入消息
- 按 Enter 或点击发送按钮发送
- 消息以聊天气泡形式显示
- 工具调用会折叠显示

#### 终端会话

- 直接在终端中输入命令
- 支持完整的终端功能（颜色、光标移动等）
- 终端自动适应窗口大小

### 权限审批

当 Claude 需要执行敏感操作时，会弹出权限审批对话框：

1. 查看请求详情（工具名称、操作描述）
2. 点击"批准"允许操作
3. 点击"拒绝"取消操作

### 关闭会话

1. 在会话列表中找到要关闭的会话
2. 点击会话右侧的 "×" 按钮
3. 确认关闭

## 配置

### 架构说明

MyCC 采用三组件架构：

```text
Web 客户端 ──WebSocket──→ Relay 中继服务器 ←──WebSocket── Daemon 守护进程
(浏览器)                    (远端部署)                    (本地运行)
```

- **Web + Relay** 通常部署在远端服务器
- **Daemon** 在本地机器运行，连接远端 Relay
- Web 与 Daemon 之间的通信经过 E2E 加密（ECDH P-256 + AES-256-GCM），Relay 仅做消息转发，无法解密

### 中继服务器（Relay）配置

Relay 支持通过 **CLI 参数**或**环境变量**配置监听地址、端口和 TLS。

| 配置项     | CLI 参数            | 环境变量   | 默认值    |
|------------|---------------------|------------|-----------|
| 监听地址   | `-H, --host <host>` | `HOST`     | `0.0.0.0` |
| 监听端口   | `-p, --port <port>` | `PORT`     | `3000`    |
| TLS 证书   | `--cert <path>`     | `TLS_CERT` | （无）    |
| TLS 私钥   | `--key <path>`      | `TLS_KEY`  | （无）    |

**CLI 参数优先于环境变量。**

```bash
# 使用 CLI 参数
mycc-relay start -H 0.0.0.0 -p 8080

# 使用环境变量
export HOST=0.0.0.0
export PORT=8080
mycc-relay start

# pnpm 方式（通过环境变量传参）
HOST=0.0.0.0 PORT=8080 pnpm --filter @mycc/relay start

# 启用 TLS（HTTPS/WSS）
mycc-relay start --cert /path/to/cert.pem --key /path/to/key.pem

# pnpm + TLS（通过环境变量传参）
TLS_CERT=/path/to/cert.pem TLS_KEY=/path/to/key.pem pnpm --filter @mycc/relay start
```

> `--cert` 和 `--key` 必须同时提供。启用 TLS 后，Relay 以 HTTPS/WSS 模式运行，Daemon 应使用 `wss://` 连接。

### 守护进程（Daemon）配置

Daemon 作为 WebSocket 客户端连接 Relay，支持配置目标中继服务器地址。

| 配置项         | CLI 参数            | 环境变量    | 默认值                |
|----------------|---------------------|-------------|-----------------------|
| 中继服务器地址 | `-r, --relay <url>` | `RELAY_URL` | `ws://localhost:3000` |

**CLI 参数优先于环境变量。**

```bash
# 连接本地中继（默认）
mycc start

# 连接远程中继服务器（无 TLS）
mycc start -r ws://relay.example.com

# 连接远程中继服务器（有 TLS，需反向代理支持）
mycc start -r wss://relay.example.com

# pnpm 方式（通过环境变量传参）
RELAY_URL=ws://relay.example.com pnpm --filter @mycc/daemon start
```

> Daemon 会自动在 URL 末尾补充 `/ws` 路径，因此 `ws://relay.example.com` 和 `ws://relay.example.com/ws` 效果相同。
> 使用 `wss://` 需要 Relay 启用 TLS（`--cert`/`--key`）或前部署反向代理（如 Nginx/Caddy）做 TLS 终结。

### Web 客户端配置

Web 客户端支持通过**环境变量**配置开发服务器和中继服务器地址。

#### 开发服务器（Vite）

| 配置项   | 环境变量    | 默认值      |
|----------|-------------|-------------|
| 监听地址 | `VITE_HOST` | `localhost` |
| 监听端口 | `VITE_PORT` | `5173`      |

```bash
# 默认启动
pnpm --filter @mycc/web dev

# 指定地址和端口
VITE_HOST=0.0.0.0 VITE_PORT=3001 pnpm --filter @mycc/web dev
```

#### 中继服务器地址

| 配置项                    | 环境变量         | 默认值                   |
|---------------------------|------------------|--------------------------|
| 中继服务器 WebSocket 地址 | `VITE_RELAY_URL` | `ws://localhost:3000/ws` |

```bash
# 连接远程中继（无 TLS）
VITE_RELAY_URL=ws://relay.example.com/ws pnpm --filter @mycc/web dev

# 连接远程中继（有 TLS）
VITE_RELAY_URL=wss://relay.example.com/ws pnpm --filter @mycc/web dev
```

也可以创建 `.env` 文件在 `packages/web/` 目录下：

```env
VITE_RELAY_URL=ws://relay.example.com/ws
VITE_HOST=0.0.0.0
VITE_PORT=3001
```

> Web 端也支持在认证页面输入 Token 前手动修改中继地址。

### 远程部署示例

> **⚠️ 重要：远程部署必须使用 HTTPS**
>
> MyCC 的 E2E 加密依赖浏览器 Web Crypto API（`crypto.subtle`），该 API **仅在安全上下文下可用**：
>
> - ✅ `https://` 任意地址
> - ✅ `http://localhost` / `http://127.0.0.1`
> - ❌ `http://<远程IP>` 或 `http://<域名>`（非 localhost 的 HTTP）
>
> 如果通过 HTTP 访问远程 Web 界面，将会出现 `Cannot read properties of undefined (reading 'generateKey')` 错误。

#### 方案 A：反向代理 + TLS（推荐生产环境）

使用 Nginx 或 Caddy 在 Relay/Web 前做 TLS 终结：

```bash
# 1. 远端：启动中继服务器
mycc-relay start -H 127.0.0.1 -p 3000

# 2. 远端：启动 Web 构建/服务
pnpm --filter @mycc/web build
# 使用 Nginx/Caddy 反向代理静态文件和 WebSocket

# 3. 本地：启动 Daemon 连接远端中继（通过 TLS）
mycc start -r wss://relay.example.com

# 4. 浏览器访问 https://web.example.com，输入 Access Token 认证
```

#### 方案 B：自签名证书 + Relay TLS（快速测试）

生成自签名证书，让 Relay 直接以 HTTPS/WSS 模式运行：

```bash
# 0. 生成自签名证书（有效期 365 天）
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout ~/.mycc/key.pem -out ~/.mycc/cert.pem \
  -days 365 -subj '/CN=mycc-relay'

# 1. 远端：启动中继服务器（TLS 模式）
mycc-relay start -H 0.0.0.0 -p 3000 --cert ~/.mycc/cert.pem --key ~/.mycc/key.pem

# 或使用 pnpm + 环境变量
TLS_CERT=~/.mycc/cert.pem TLS_KEY=~/.mycc/key.pem HOST=0.0.0.0 PORT=3000 pnpm --filter @mycc/relay start:fg

# 2. 远端：启动 Web 开发服务器（HTTPS 模式）
VITE_HOST=0.0.0.0 VITE_HTTPS=true pnpm --filter @mycc/web dev

# 3. 本地：启动 Daemon 连接远端中继（WSS）
RELAY_URL=wss://203.0.113.10:3000 pnpm --filter @mycc/daemon start:fg

# 4. 浏览器访问 https://203.0.113.10:5173，接受自签名证书后输入 Access Token
```

> 自签名证书会触发浏览器安全警告，点击「高级」→「继续访问」即可。
> Daemon 连接 `wss://` 自签名证书的 Relay 时，Node.js 默认会拒绝不受信任的证书。可设置环境变量 `NODE_TLS_REJECT_UNAUTHORIZED=0` 跳过验证（仅限测试环境）。

#### 方案 C：Vite HTTPS + Relay 代理（无需证书）

如果不想为 Relay 配置证书，可以让 Vite 代理 WebSocket 到本地 Relay：

```bash
# 1. 远端：启动中继服务器（普通 HTTP/WS）
mycc-relay start -H 0.0.0.0 -p 3000

# 2. 远端：启动 Web 开发服务器（HTTPS 模式，自动代理 /ws 到 Relay）
VITE_HOST=0.0.0.0 VITE_HTTPS=true VITE_RELAY_URL=ws://localhost:3000/ws pnpm --filter @mycc/web dev

# 3. 本地：启动 Daemon 连接远端中继（普通 WS）
RELAY_URL=ws://203.0.113.10:3000 pnpm --filter @mycc/daemon start:fg

# 4. 浏览器访问 https://203.0.113.10:5173，接受自签名证书后输入 Access Token
```

> 此方案中浏览器通过 HTTPS 访问 Vite，Vite 内部将 `/ws` 代理到本地 Relay 的 `ws://localhost:3000/ws`。Daemon 直接用 `ws://` 连接 Relay，无需 TLS。

## 安全注意事项

### 端到端加密

- 所有消息使用 AES-256-GCM 加密
- 密钥通过 ECDH P-256 交换
- 中继服务器无法解密消息内容

### Access Token 安全

- Access Token 格式为 `mycc-<32位十六进制>`，安全随机生成
- Token 持久存储于 `~/.mycc/pairing.json`，可反复使用
- 认证后公钥绑定，防止中间人攻击

### 建议

1. **使用 HTTPS/WSS** - 生产环境务必使用加密连接
2. **限制访问** - 中继服务器应限制可访问的 IP
3. **定期更换 Token** - 如有安全顾虑可重新生成 Access Token

## 故障排除

### 无法连接到中继服务器

1. 确认中继服务器已启动
2. 检查 URL 是否正确
3. 检查防火墙设置
4. 检查网络连接

### 认证失败

1. 确认 Access Token 正确（以 `mycc-` 开头）
2. 确认守护进程已启动并连接到中继
3. 确认 Web 端中继地址与守护进程一致

### 会话无响应

1. 检查守护进程日志
2. 确认本地 Claude CLI 正常工作
3. 尝试重新创建会话

### Web 界面空白

1. 打开浏览器开发者工具查看错误
2. 确认 Web 服务已启动
3. 清除浏览器缓存

## 常见问题

### Q: Access Token 在哪里获取？

启动守护进程后终端会显示 Access Token，也可以运行 `mycc token` 随时查看。

### Q: 可以同时连接多个 Web 客户端吗？

可以。多个 Web 客户端可以使用同一个 Access Token 认证，互不影响。

### Q: 断网后会自动重连吗？

会。守护进程会自动尝试重连中继服务器，使用指数退避策略。

### Q: 如何更新 Claude 模型？

创建会话时可以指定模型参数，或在 Claude 会话中直接切换。

### Q: 终端会话支持哪些功能？

支持完整的终端功能，包括：
- 颜色输出
- 光标控制
- 历史记录
- Tab 补全
- 特殊按键

### Q: 如何查看历史消息？

会话历史保存在客户端内存中，刷新页面后会清空。未来版本将支持持久化存储。
