# MyTermux API 文档

版本：`1.0.0`

MyTermux 协议分为两层：

1. 传输层（Relay 可见）：设备注册、token 认证、路由
2. 应用层（E2E 加密）：终端会话管理与交互

说明：Web 登录和 Web 偏好配置已迁移到 Web 本地数据库，不再通过 Relay `/api/web-auth/*` 或 `/api/web-preferences`。

## 0. Token 定义

- `MYTERMUX_WEB_LINK_TOKEN`：Web 访问 Relay 管理 API 与 ws-ticket 的鉴权 token（Relay 配置）
- `MYTERMUX_DAEMON_LINK_TOKEN`：Daemon 连接 Relay 的链路授权 token（Relay 配置）
- `MYTERMUX_DAEMON_TOKEN`：Web 控制 Daemon 的业务授权 token（Daemon 配置，存储在 `daemon.db`）

## 1. Web 本地认证（非 Relay API）

- 默认账号：`admin` / `mytermux`
- 首次登录必须修改账号和密码
- 存储位置：浏览器 IndexedDB（`mytermux_web_db`）
- 会话、快捷键、Relay 地址与 Web Link Token 都在 Web 本地数据库中管理

## 2. Relay HTTP API

当 Relay 配置了 `MYTERMUX_WEB_LINK_TOKEN` 时，以下管理 API 必须带请求头：

```http
x-mytermux-web-link-token: <token>
```

### 2.1 Daemon 管理

#### `GET /api/daemons`

响应：

```json
{
  "onlineDaemons": [
    {
      "daemonId": "daemon-1",
      "connectedAt": 1730000000000,
      "lastHeartbeat": 1730000002000,
      "connectedClients": 2
    }
  ],
  "profiles": [
    {
      "id": "profile-1",
      "name": "MacBook",
      "daemonId": "daemon-1",
      "accessTokenMasked": "mytermux-abcd...1234",
      "hasToken": true,
      "defaultCwd": "/Users/me",
      "defaultCommandMode": "tmux",
      "defaultCommandValue": null,
      "online": true,
      "lastHeartbeat": 1730000002000,
      "connectedClients": 2,
      "createdAt": 1730000000000,
      "updatedAt": 1730000001000
    }
  ]
}
```

规则：

- `daemonId` 与 profile 一一对应
- 新在线 `daemonId` 会自动生成默认 profile
- daemon 离线后 profile 会保留
- 不支持手动新增/绑定 profile
- 仅支持手动删除离线 profile

#### `PATCH /api/daemon-profiles/:id`

- 仅允许编辑在线 daemon 的 profile
- `daemonId` 不可修改
- 可更新字段：`name`、`accessToken`、`defaultCwd`、`defaultCommandMode`、`defaultCommandValue`

#### `DELETE /api/daemon-profiles/:id`

- 仅允许删除离线 daemon 的 profile
- 在线 daemon 的 profile 删除会返回 `409`

#### `POST /api/daemon-profiles`
#### `POST /api/daemon-profiles/:id/bind`

- 均已禁用（返回 `405`）

### 2.2 ws-ticket

#### `POST /api/ws-ticket`

- 请求体必须带 `profileId`
- 当开启 `MYTERMUX_WEB_LINK_TOKEN` 时，需通过请求头 `x-mytermux-web-link-token` 或请求体 `webLinkToken` 提供一致 token

请求：

```json
{
  "profileId": "profile-uuid"
}
```

响应：

```json
{
  "ticket": "base64url-token",
  "expiresAt": 1730000000000,
  "profileId": "profile-uuid",
  "daemonId": "daemon-123"
}
```

说明：

- ticket 一次性消费
- 有效期 60 秒
- client 连接 `/ws` 时必须携带 `?ticket=...`

## 3. 传输层协议（WebSocket）

连接地址：

- 本地开发/测试：`ws://<host>:<port>/ws`
- 生产部署：`wss://<domain>/ws`（通过 Nginx 反向代理）

默认端口：

- Web Client：`127.0.0.1:62100`
- Relay：`127.0.0.1:62200`
- Daemon 本地状态监听：`127.0.0.1:62300`

### 3.1 通用结构

```ts
interface TransportMessage {
  type: 'register' | 'token_auth' | 'token_ack' | 'message' | 'heartbeat' | 'error';
  from: string;
  to?: string;
  payload: string;
  timestamp: number;
}
```

### 3.2 `register`

- daemon 注册时可带：
  - `daemonLinkToken`（对应 `MYTERMUX_DAEMON_LINK_TOKEN`）
  - `daemonToken`（对应 `MYTERMUX_DAEMON_TOKEN`，兼容旧字段 `accessToken`）
- client 注册路径要求已通过 ws-ticket 准入

### 3.3 `token_auth`

- client 发起 daemon 认证
- daemon token 可由 payload 传递（`daemonToken`，兼容旧字段 `accessToken`），或由 ws-ticket 注入

### 3.4 `token_ack`

成功示例（client）：

```json
{
  "success": true,
  "daemonId": "daemon-1",
  "publicKey": "..."
}
```
