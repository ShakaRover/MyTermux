# MyTermux 用户指南

## 1. 使用流程总览

MyTermux 当前推荐流程：

1. 启动 relay（Web 登录入口 + 中继）
2. 启动 daemon（提供 Access Token）
3. 浏览器登录 Web 管理中心
4. 在 Web 中编辑 daemon profile 配置
5. 连接 daemon 并进入终端会话

## 2. 前置要求

- Node.js >= 20
- pnpm >= 9
- relay 与 daemon 网络可达

## 3. 首次启动

### 3.1 安装与构建

```bash
pnpm install
pnpm turbo run build
```

### 3.2 启动 relay

```bash
pnpm --filter @mytermux/relay start:fg
```

默认地址：

- HTTP: `http://localhost:3000`
- WebSocket: `ws://localhost:3000/ws`

> 开发环境未设置管理员环境变量时，默认账号：`admin`，默认密码：`mytermux`。

### 3.3 启动 daemon

```bash
pnpm --filter @mytermux/daemon start:fg
```

查看完整 token：

```bash
pnpm --filter @mytermux/daemon token
```

### 3.4 启动 Web

```bash
pnpm --filter @mytermux/web dev
```

浏览器打开 `http://localhost:5173`，进入 `/login` 登录。

## 4. Daemon 管理中心

登录后进入 `/daemons`：

1. 在线 daemon 会自动生成默认 profile（`daemonId` 与 profile 一一对应）
2. 在线 profile 支持编辑（名称、token、默认目录、默认命令）
3. daemon 离线后 profile 会保留，可手动删除离线 profile
4. 点击“连接”进入 `/sessions`

默认命令支持：

- `zsh`
- `bash`
- `tmux`
- `custom`

## 5. Dashboard 会话操作

在 `/sessions`：

1. 创建会话（可选覆盖工作目录与启动命令）
2. 左侧会话列表可查看 `PID`
3. 支持输入、输出、resize、关闭会话
4. 移动端在软键盘弹出时显示快捷键栏（可在 `/daemons` 配置）

## 6. 常用命令

```bash
# daemon
pnpm --filter @mytermux/daemon start
pnpm --filter @mytermux/daemon stop
pnpm --filter @mytermux/daemon status
pnpm --filter @mytermux/daemon token

# relay
pnpm --filter @mytermux/relay start
pnpm --filter @mytermux/relay stop
pnpm --filter @mytermux/relay status
```

## 7. 本地数据目录

`~/.mytermux`

- `auth.json`：daemon 认证信息
- `daemon.pid` / `daemon.status`
- `relay.pid` / `relay.log`
- `relay.db`：Web 登录、锁定计数、profile、偏好配置

## 8. 故障排查

### 8.1 Relay 状态正常但 Web 登录失败

- 检查管理员环境变量是否正确（见 `docs/DEPLOYMENT.md`）
- 查看 `relay.log`

### 8.2 Daemon 在线但无法连接

- 确认 profile 已配置有效 token
- 在 `/daemons` 中确认 profile 对应 daemonId 与在线 daemon 一致
- 确认 token 前缀为 `mytermux-`

### 8.3 终端无输出或频繁断开

- 检查 relay 与 daemon 网络
- 查看 `GET /health` 和 daemon 日志
- 重连 profile（单活连接会自动清理旧连接）

## 9. 历史目录说明

MyTermux 不会自动迁移或删除历史版本目录，请手动处理旧数据。
