# OpenTermux 用户指南

## 1. OpenTermux 是什么

OpenTermux 提供 Web 远程终端能力：

- 本地运行 daemon
- 浏览器连接 relay
- 在网页里操作本地终端

## 2. 前置要求

- Node.js >= 20
- pnpm >= 9
- 可访问 relay 的网络环境

## 3. 首次使用

### 3.1 安装依赖

```bash
pnpm install
pnpm turbo run build
```

### 3.2 启动 relay

```bash
pnpm --filter @opentermux/relay start:fg
```

默认地址：

- HTTP: `http://localhost:3000`
- WebSocket: `ws://localhost:3000/ws`

### 3.3 启动 daemon

```bash
pnpm --filter @opentermux/daemon start:fg
```

Daemon 会输出 Access Token（展示时可能脱敏）。

如需完整 Token：

```bash
pnpm --filter @opentermux/daemon token
```

### 3.4 启动 Web

```bash
pnpm --filter @opentermux/web dev
```

浏览器打开 `http://localhost:5173`，在认证页输入完整 Access Token。

## 4. 使用终端会话

1. 进入 Dashboard
2. 点击“新建会话”
3. 可选填写工作目录
4. 在终端视图输入命令并查看输出
5. 可关闭会话或继续保持运行

## 5. 常用运维命令

```bash
# daemon
pnpm --filter @opentermux/daemon start
pnpm --filter @opentermux/daemon stop
pnpm --filter @opentermux/daemon status
pnpm --filter @opentermux/daemon token

# relay
pnpm --filter @opentermux/relay start
pnpm --filter @opentermux/relay stop
pnpm --filter @opentermux/relay status
```

## 6. 本地数据位置

- 运行目录：`~/.opentermux`
- 认证文件：`~/.opentermux/auth.json`
- daemon 状态：`~/.opentermux/daemon.status`
- Web 本地缓存键：`opentermux:auth_token`

## 7. 故障排查

### 7.1 无法连接 relay

- 检查 relay 是否运行
- 访问 `http://<relay-host>:<relay-port>/health`
- 检查防火墙与端口映射

### 7.2 Token 认证失败

- 确认 Token 前缀是 `opentermux-`
- 确认 daemon 在线
- 在 daemon 侧重新生成 Token：

```bash
pnpm --filter @opentermux/daemon token
```

### 7.3 Web 一直无法恢复连接

- 清理浏览器本地缓存（`opentermux:auth_token`）
- 刷新页面并重新输入 Token

## 8. 历史目录说明

OpenTermux 不会自动迁移或删除历史版本目录。
如需清理，请手动处理旧版本数据。
