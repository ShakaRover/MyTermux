# OpenTermux API 文档

版本：`1.0.0`

OpenTermux 协议分为两层：

1. 传输层（Relay 可见）：设备注册、token 认证、路由
2. 应用层（E2E 加密）：终端会话管理与交互

另外，Relay 提供 Web 管理 API（登录、daemon profile、偏好配置、ws-ticket）。

## 1. Web 认证与安全

### 1.1 Cookie 与 CSRF

- 会话 Cookie：`opentermux_web_session`（`HttpOnly`, `SameSite=Strict`）
- CSRF Cookie：`opentermux_csrf_token`
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
  "username": "admin",
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
      "accessTokenMasked": "opentermux-abcd...1234",
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

#### `POST /api/daemon-profiles`

请求：

```json
{
  "name": "MacBook",
  "accessToken": "opentermux-...",
  "daemonId": null,
  "defaultCwd": "/Users/me/project",
  "defaultCommandMode": "zsh",
  "defaultCommandValue": null
}
```

#### `PATCH /api/daemon-profiles/:id`

- 与创建字段一致，按需传递

#### `POST /api/daemon-profiles/:id/bind`

请求：

```json
{
  "daemonId": "daemon-1"
}
```

### 2.4 Web 偏好配置

#### `GET /api/web-preferences`

响应：

```json
{
  "shortcuts": [
    { "id": "ctrl-c", "label": "Ctrl+C", "value": "\u0003" }
  ],
  "commonChars": ["/", "~", "|"],
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
  "commonChars": ["/", "~", "|"]
}
```

## 3. 传输层协议（WebSocket）

连接地址：`ws://<host>:<port>/ws`（TLS 为 `wss://`）

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

- daemon 注册时可带 Access Token
- client 注册路径要求已通过 ws-ticket 准入

### 3.3 `token_auth`

- client 发起 daemon 认证
- token 可由 payload 传递，或由 ws-ticket 绑定的 profile token 注入

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
