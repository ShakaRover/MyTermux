# MyTermux API 文档

版本：`1.0.0`

MyTermux 协议分为两层：

1. 传输层（Relay 可见）：设备注册、token 认证、路由
2. 应用层（E2E 加密）：终端会话管理与交互

另外，Relay 提供 Web 管理 API（登录、daemon profile、偏好配置、ws-ticket）。

协议流转图请见：[SERVICE_PROTOCOL_FLOW.md](./SERVICE_PROTOCOL_FLOW.md)。

## 0. Token 定义

- `MYTERMUX_WEB_LINK_TOKEN`：Web 前端申请 WS 链接授权使用，必须授权成功才可连接 Relay，保存在 Relay 配置中。
- `MYTERMUX_DAEMON_LINK_TOKEN`：Daemon 连接 Relay 的链路授权 token，必须授权成功才可连接，保存在 Relay 配置中。
- `MYTERMUX_DAEMON_TOKEN`：Web 前端操控 Daemon 的业务授权 token，保存在 Daemon 配置中（`auth.json`）。

## 1. Web 认证与安全

### 1.1 Cookie 与 CSRF

- 会话 Cookie：`mytermux_web_session`（`HttpOnly`, `SameSite=Strict`）
- CSRF Cookie：`mytermux_csrf_token`
- 写操作（POST/PATCH/PUT）需要 `X-CSRF-Token` 请求头

### 1.2 暴力破解防护

- IP 维度：10 分钟最多 30 次尝试
- 账号+IP 维度：
  - 第 5 次失败后锁定 5 分钟
  - 继续失败按 2 倍退避，最长 60 分钟
- 成功登录后清零计数

## 2. Relay HTTP API

### 2.1 认证接口

#### `POST /api/web-auth/login`

- 按用户名/密码模式登录。
- 首次初始化默认管理员账号：`admin` / `mytermux`。
- 若返回 `mustChangePassword=true`，表示必须先调用修改凭据接口。

请求：

```json
{
  "username": "admin",
  "password": "******"
}
```

响应：

```json
{
  "success": true,
  "authenticated": true,
  "username": "admin",
  "mustChangePassword": true,
  "expiresAt": 1730000000000
}
```

#### `POST /api/web-auth/change-credentials`

- 需要登录 + CSRF
- 用于首次登录后强制修改账号和密码

请求：

```json
{
  "username": "new-admin",
  "password": "new-password"
}
```

响应：

```json
{
  "success": true,
  "authenticated": true,
  "username": "new-admin",
  "mustChangePassword": false,
  "expiresAt": 1730000000000
}
```

#### `POST /api/web-auth/logout`

- 需要登录 + CSRF

响应：

```json
{ "success": true }
```

#### `GET /api/web-auth/me`

响应：

```json
{
  "authenticated": true,
  "username": "admin",
  "mustChangePassword": false,
  "expiresAt": 1730000000000
}
```

#### `GET /api/web-auth/csrf`

响应：

```json
{
  "csrfToken": "..."
}
```

### 2.2 ws-ticket

#### `POST /api/ws-ticket`

- 需要登录 + CSRF
- 请求体必须带 `profileId`
- 若 Relay 配置了 `MYTERMUX_WEB_LINK_TOKEN`，请求体必须携带一致的 `webLinkToken`

请求：

```json
{
  "profileId": "profile-uuid",
  "webLinkToken": "relay-web-link-token"
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

### 2.3 Daemon 管理

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

### 2.4 Web 偏好配置

#### `GET /api/web-preferences`

响应：

```json
{
  "shortcuts": [
    { "id": "ctrl-c", "label": "Ctrl+C", "value": "\u0003" }
  ],
  "commonChars": ["/", "~", "|"],
  "relayUrl": "ws://127.0.0.1:62200/ws",
  "webLinkToken": "relay-web-link-token",
  "updatedAt": 1730000000000
}
```

#### `PUT /api/web-preferences`

请求：

```json
{
  "shortcuts": [
    { "id": "ctrl-c", "label": "Ctrl+C", "value": "\u0003" }
  ],
  "commonChars": ["/", "~", "|"],
  "relayUrl": "ws://127.0.0.1:62200/ws",
  "webLinkToken": "relay-web-link-token"
}
```

## 3. 传输层协议（WebSocket）

连接地址：

- 本地开发/测试：`ws://<host>:<port>/ws`（无证书）
- 生产部署：通过 Nginx 反向代理对外提供 `wss://<domain>/ws`（必须启用证书）

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
  - `daemonLinkToken`（对应 `MYTERMUX_DAEMON_LINK_TOKEN`，用于连接 Relay 授权）
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

失败示例（client）：

```json
{
  "success": false,
  "error": "Access Token 无效或 Daemon 未连接"
}
```

## 4. 应用层协议（E2E 加密）

### 4.1 通用结构

```ts
interface AppMessage {
  action:
    | 'session:create'
    | 'session:created'
    | 'session:list'
    | 'session:list_response'
    | 'session:close'
    | 'session:closed'
    | 'session:input'
    | 'session:output'
    | 'session:resize'
    | 'error';
  messageId?: string;
}
```

### 4.2 会话模型

```ts
type SessionType = 'terminal';

interface SessionInfo {
  id: string;
  type: 'terminal';
  status: 'starting' | 'running' | 'stopped' | 'error';
  pid?: number;
  createdAt: number;
  title: string;
  outputHistory?: string;
}

interface SessionOptions {
  cwd?: string;
  shell?: string;
  startupCommand?: string;
  cols?: number;
  rows?: number;
}
```

`startupCommand` 用于会话创建后自动执行默认命令（如 `zsh`、`tmux` 或自定义命令）。

## 5. 健康检查

### `GET /health`

```json
{
  "status": "ok",
  "timestamp": 1730000000000,
  "version": "1.0.0",
  "connections": {
    "daemons": 1,
    "clients": 2,
    "accessTokens": 1
  }
}
```
