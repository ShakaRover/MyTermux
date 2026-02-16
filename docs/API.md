# OpenTermux API 文档

本文档描述 OpenTermux 当前实现的通信协议与服务接口。

- 产品：OpenTermux
- 定位：Web 远程终端
- 版本：1.0.0

## 总览

OpenTermux 协议分两层：

1. 传输层（Relay 可见）
2. 应用层（E2E 加密，Relay 不解密）

## 传输层协议（WebSocket）

### 连接地址

- Relay WebSocket：`ws://<host>:<port>/ws`
- TLS：`wss://<host>:<port>/ws`

### 通用结构

```ts
interface TransportMessage {
  type: 'register' | 'token_auth' | 'token_ack' | 'message' | 'heartbeat' | 'error';
  from: string;
  to?: string;
  payload: string;
  timestamp: number;
}
```

### `register`

设备注册。

```json
{
  "type": "register",
  "from": "daemon-1",
  "payload": "{\"deviceType\":\"daemon\",\"publicKey\":\"...\",\"accessToken\":\"opentermux-...\"}",
  "timestamp": 1730000000000
}
```

- `daemon` 注册时可带 `accessToken`
- `client` 注册时不需要 `accessToken`

### `token_auth`

客户端使用 Access Token 请求认证。

```json
{
  "type": "token_auth",
  "from": "client-1",
  "payload": "{\"deviceType\":\"client\",\"publicKey\":\"...\",\"accessToken\":\"opentermux-...\"}",
  "timestamp": 1730000000000
}
```

### `token_ack`

认证结果回执。

成功（发给 client）：

```json
{
  "type": "token_ack",
  "from": "relay",
  "to": "client-1",
  "payload": "{\"success\":true,\"daemonId\":\"daemon-1\",\"publicKey\":\"...\"}",
  "timestamp": 1730000000000
}
```

成功（通知 daemon）：

```json
{
  "type": "token_ack",
  "from": "relay",
  "to": "daemon-1",
  "payload": "{\"success\":true,\"clientId\":\"client-1\",\"publicKey\":\"...\"}",
  "timestamp": 1730000000000
}
```

失败（发给 client）：

```json
{
  "type": "token_ack",
  "from": "relay",
  "to": "client-1",
  "payload": "{\"success\":false,\"error\":\"Access Token 无效或 Daemon 未连接\"}",
  "timestamp": 1730000000000
}
```

### `message`

应用层加密消息传输载体。`payload` 为加密串。

### `heartbeat`

心跳保活消息。

### `error`

传输层错误消息。

```json
{
  "type": "error",
  "from": "relay",
  "payload": "{\"code\":\"ROUTE_FAILED\",\"message\":\"接收者设备未连接\"}",
  "timestamp": 1730000000000
}
```

## 应用层协议（E2E 加密）

### 通用结构

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

### 会话模型

```ts
type SessionType = 'terminal';

interface SessionOptions {
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
}
```

### `session:create`

```json
{
  "action": "session:create",
  "messageId": "1730000000-abc123",
  "sessionType": "terminal",
  "options": {
    "cwd": "/home/user/project"
  }
}
```

### `session:created`

```json
{
  "action": "session:created",
  "messageId": "1730000000-def456",
  "session": {
    "id": "session-1",
    "type": "terminal",
    "status": "running",
    "createdAt": 1730000000000,
    "title": "bash: /home/user/project"
  }
}
```

### `session:list` / `session:list_response`

`session:list_response` 会返回 `sessions`，并可附带 `outputHistory` 供重连回放。

### `session:input`

```json
{
  "action": "session:input",
  "messageId": "1730000000-ghi789",
  "sessionId": "session-1",
  "data": "ls -la\n"
}
```

### `session:output`

```json
{
  "action": "session:output",
  "messageId": "1730000000-jkl012",
  "sessionId": "session-1",
  "data": "total 8\r\n"
}
```

### `session:resize`

```json
{
  "action": "session:resize",
  "messageId": "1730000000-mno345",
  "sessionId": "session-1",
  "cols": 120,
  "rows": 32
}
```

### `session:close` / `session:closed`

用于主动关闭和关闭通知。

### `error`

应用层错误。

```json
{
  "action": "error",
  "messageId": "1730000000-pqr678",
  "code": "SESSION_CREATE_FAILED",
  "message": "工作目录不存在"
}
```

## Relay HTTP 接口

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

### `GET /`

```json
{
  "name": "OpenTermux Relay Server",
  "version": "1.0.0",
  "endpoints": {
    "/health": "GET - 健康检查",
    "/ws": "WebSocket - 设备连接端点"
  }
}
```

### `GET /ws`

非升级请求返回 `426`。

## 错误码（常见）

- `INVALID_JSON`
- `INVALID_MESSAGE`
- `INVALID_PAYLOAD`
- `INVALID_DEVICE_TYPE`
- `ROUTE_FAILED`
- `PEER_DISCONNECTED`

## 安全说明

- Access Token 格式：`opentermux-<32hex>`
- 客户端与 daemon 认证后使用 ECDH 派生共享密钥
- 应用层数据以 AES-GCM 加密后通过 Relay 转发
