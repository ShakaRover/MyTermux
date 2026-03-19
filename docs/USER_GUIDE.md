# MyTermux 用户指南

## 1. 使用流程总览

MyTermux 当前推荐流程：

1. 启动 relay（中继与 profile API）
2. 启动 daemon（提供 `MYTERMUX_DAEMON_TOKEN`）
3. 浏览器登录 Web 管理中心（本地登录，不依赖 Relay）
4. 在 Web 中编辑 daemon profile 配置
5. 连接 daemon 并进入终端会话

## 2. 前置要求

- Node.js >= 20
- pnpm >= 9
- relay 与 daemon 网络可达
- 本地使用无证书模型（HTTP + WS）

## 3. 首次启动

### 3.1 安装与构建

```bash
pnpm install
pnpm turbo run build
cp .env.example .env
```

编辑 `.env`，至少填写：

- `MYTERMUX_WEB_LINK_TOKEN`
- `MYTERMUX_DAEMON_LINK_TOKEN`
- `RELAY_WEB_MASTER_KEY`

### 3.2 一键启动本地测试

```bash
pnpm start:local:test
```

默认地址：

- Web Client: `http://127.0.0.1:62100`
- Relay HTTP: `http://127.0.0.1:62200`
- Relay WebSocket: `ws://127.0.0.1:62200/ws`

说明：本地运行不需要证书，不要配置 `TLS_CERT` / `TLS_KEY`。

### 3.3 Web 首次登录

- 默认账号密码：`admin` / `mytermux`
- 首次登录后必须修改账号和密码
- 登录信息保存在浏览器本地数据库（IndexedDB：`mytermux_web_db`）

### 3.4 分别启动（可选）

```bash
bash ./scripts/relay/start-fg.sh
bash ./scripts/daemon/start-fg.sh
bash ./scripts/web/start-fg.sh
```

Daemon 默认监听：

- 本地状态地址：`http://127.0.0.1:62300`

查看完整 `MYTERMUX_DAEMON_TOKEN`：

```bash
pnpm --filter @mytermux/daemon token
```

重置 `MYTERMUX_DAEMON_TOKEN`（会清空已认证客户端，需先停止 daemon）：

```bash
pnpm --filter @mytermux/daemon token -- --reset
```

设置 daemon -> Relay 链路 token（写入 `daemon.db`，下次启动生效）：

```bash
pnpm --filter @mytermux/daemon relay-token -- --set '<daemon-link-token>'
pnpm --filter @mytermux/daemon relay-token -- --clear
```

浏览器打开 `http://127.0.0.1:62100`，进入 `/login` 登录。

## 4. Daemon 管理中心

登录后进入 `/daemons`：

1. 在线 daemon 会自动生成默认 profile（`daemonId` 与 profile 一一对应）
2. 在线 profile 支持编辑（名称、token、默认目录、默认命令）
3. daemon 离线后 profile 会保留，可手动删除离线 profile
4. 可在 Web 保存 Relay WebSocket 地址与 `MYTERMUX_WEB_LINK_TOKEN`
5. 点击“连接”进入 `/sessions`

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
pnpm --filter @mytermux/daemon token -- --reset
pnpm --filter @mytermux/daemon relay-token
pnpm --filter @mytermux/daemon relay-token -- --set '<daemon-link-token>'
pnpm --filter @mytermux/daemon relay-token -- --clear

# relay
pnpm --filter @mytermux/relay start
pnpm --filter @mytermux/relay stop
pnpm --filter @mytermux/relay status

# 脚本方式
pnpm daemon:token:get
pnpm daemon:token:reset
pnpm daemon:relay-token:set -- '<daemon-link-token>'
bash ./scripts/daemon/set-relay-token.sh --clear
```

## 7. 本地数据目录

`~/.mytermux`

- `daemon.db`：daemon 认证与 token 数据
- `daemon.pid` / `daemon.status`
- `relay.db`：daemon profile 数据
- `relay.pid` / `relay.log`

Web 本地数据：

- 浏览器 IndexedDB：`mytermux_web_db`

## 8. 故障排查

### 8.1 Relay 状态正常但 Web 登录失败

- Web 登录不依赖 Relay，先检查浏览器本地数据库是否被清理
- 确认默认账号 `admin` / `mytermux`（首次登录后需改密）

### 8.2 Daemon 在线但无法连接

- 确认 profile 已配置有效 `MYTERMUX_DAEMON_TOKEN`
- 在 `/daemons` 中确认 profile 对应 daemonId 与在线 daemon 一致
- 若启用链路鉴权，确认 `MYTERMUX_WEB_LINK_TOKEN` 与 `MYTERMUX_DAEMON_LINK_TOKEN` 均一致

### 8.3 终端无输出或频繁断开

- 检查 relay 与 daemon 网络
- 查看 `GET /health` 与 daemon 日志
- 重连 profile（单活连接会自动清理旧连接）

## 9. 历史目录说明

MyTermux 不会自动迁移或删除历史版本目录（daemon 启动时会尝试将 `auth.json` 迁移到 `daemon.db`）。

## 10. 生产部署说明

- 正式环境必须通过 Nginx 反向代理并启用证书。
- 浏览器侧访问 `https://<domain>`，WebSocket 使用 `wss://<domain>/ws`。
