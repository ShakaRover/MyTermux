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

在一个终端中运行：

```bash
pnpm --filter @mycc/relay start
```

你会看到：
```
[Relay] MyCC Relay Server 启动中，端口: 3000...
[Relay] MyCC Relay Server 已启动
[Relay] HTTP: http://localhost:3000
[Relay] WebSocket: ws://localhost:3000/ws
[Relay] 健康检查: http://localhost:3000/health
```

### 第四步：启动守护进程

在另一个终端中运行：

```bash
# 前台运行（推荐用于调试）
pnpm --filter @mycc/daemon start -- -f

# 或后台运行
pnpm --filter @mycc/daemon start
```

你会看到配对码：
```
启动守护进程，连接到中继服务器: ws://localhost:3000
守护进程已启动
已连接到中继服务器

配对码: 123456
有效期: 300 秒
```

### 第五步：启动 Web 界面

在第三个终端中运行：

```bash
pnpm --filter @mycc/web dev
```

打开浏览器访问 `http://localhost:5173`

### 第六步：配对

1. 在 Web 界面输入守护进程显示的 6 位配对码
2. 点击"配对"按钮
3. 配对成功后自动跳转到仪表盘

## 守护进程命令

在项目根目录下，你可以使用 pnpm 命令来管理各模块。基本格式为：
`pnpm --filter <package-name> <command> [-- <args>]`

### 使用 pnpm 运行

```bash
# 前台启动（终端可见输出，适合调试）
pnpm --filter @mycc/daemon start -- -f

# 后台启动（作为守护进程运行）
pnpm --filter @mycc/daemon start

# 停止守护进程
pnpm --filter @mycc/daemon stop

# 查看运行状态
pnpm --filter @mycc/daemon status

# 重新生成配对码
pnpm --filter @mycc/daemon pair
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
已配对客户端: 1
```

### 重新生成配对码

```bash
# 使用 pnpm
pnpm --filter @mycc/daemon pair

# 或使用 mycc 命令
mycc pair
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

### 中继服务器配置

通过环境变量配置：

```bash
# 设置端口
export PORT=3000

# 启动
pnpm --filter @mycc/relay start
```

### Web 配置

编辑 `packages/web/src/stores/connectionStore.ts` 修改默认中继地址：

```typescript
relayUrl: 'ws://localhost:3000',
```

## 安全注意事项

### 端到端加密

- 所有消息使用 AES-256-GCM 加密
- 密钥通过 ECDH P-256 交换
- 中继服务器无法解密消息内容

### 配对码安全

- 配对码有效期 5 分钟
- 每个配对码只能使用一次
- 配对后公钥绑定，防止中间人攻击

### 建议

1. **使用 HTTPS/WSS** - 生产环境务必使用加密连接
2. **限制访问** - 中继服务器应限制可访问的 IP
3. **定期重新配对** - 定期生成新的配对以更新密钥

## 故障排除

### 无法连接到中继服务器

1. 确认中继服务器已启动
2. 检查 URL 是否正确
3. 检查防火墙设置
4. 检查网络连接

### 配对失败

1. 确认配对码正确
2. 确认配对码未过期
3. 确认守护进程已连接到中继

### 会话无响应

1. 检查守护进程日志
2. 确认本地 Claude CLI 正常工作
3. 尝试重新创建会话

### Web 界面空白

1. 打开浏览器开发者工具查看错误
2. 确认 Web 服务已启动
3. 清除浏览器缓存

## 常见问题

### Q: 配对码过期怎么办？

运行 `mycc pair` 重新生成配对码。

### Q: 可以同时配对多个 Web 客户端吗？

可以。每次生成新的配对码可以配对新的客户端，已配对的客户端不受影响。

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
