# MyCC API 文档

## 概述

MyCC 使用两层消息协议：
- **传输层** - 中继服务器可见，用于路由
- **应用层** - E2E 加密，中继服务器无法解密

## HTTP API

### 健康检查

```
GET /health
```

**响应：**
```json
{
  "status": "ok",
  "timestamp": 1234567890,
  "version": "0.1.0",
  "connections": {
    "daemons": 5,
    "clients": 12,
    "pairingCodes": 2
  }
}
```

### 服务器信息

```
GET /
```

**响应：**
```json
{
  "name": "MyCC Relay Server",
  "version": "0.1.0",
  "endpoints": {
    "/health": "GET - 健康检查",
    "/ws": "WebSocket - 设备连接端点"
  }
}
```

## WebSocket API

### 连接端点

```
WebSocket: ws://localhost:3000/ws
```

### 传输层消息格式

所有 WebSocket 消息都使用 JSON 格式：

```typescript
interface TransportMessage {
  /** 消息类型 */
  type: TransportMessageType;
  /** 发送者设备 ID */
  from: string;
  /** 接收者设备 ID（可选） */
  to?: string;
  /** 消息载荷 */
  payload: string;
  /** 时间戳 */
  timestamp: number;
}

type TransportMessageType =
  | 'register'    // 设备注册
  | 'pair'        // 配对请求
  | 'pair_ack'    // 配对确认
  | 'message'     // 加密消息
  | 'heartbeat'   // 心跳
  | 'error';      // 错误
```

---

## 传输层协议

### register - 设备注册

**发送方：** Daemon / Client
**接收方：** Relay

**请求：**
```json
{
  "type": "register",
  "from": "device-id",
  "payload": "{\"deviceType\":\"daemon\",\"publicKey\":\"base64-key\"}",
  "timestamp": 1234567890
}
```

**Payload 结构：**
```typescript
{
  deviceType: 'daemon' | 'client';
  publicKey: string;  // Base64 编码的公钥
}
```

---

### pair - 配对请求

**发送方：** Client
**接收方：** Relay → Daemon

**请求：**
```json
{
  "type": "pair",
  "from": "client-id",
  "payload": "{\"code\":\"123456\",\"publicKey\":\"base64-key\"}",
  "timestamp": 1234567890
}
```

**Payload 结构：**
```typescript
{
  code: string;       // 6 位配对码
  publicKey: string;  // 客户端公钥
  name?: string;      // 可选的客户端名称
}
```

---

### pair_ack - 配对确认

**发送方：** Daemon
**接收方：** Client

**成功响应：**
```json
{
  "type": "pair_ack",
  "from": "daemon-id",
  "to": "client-id",
  "payload": "{\"success\":true,\"daemonId\":\"daemon-id\",\"publicKey\":\"base64-key\"}",
  "timestamp": 1234567890
}
```

**失败响应：**
```json
{
  "type": "pair_ack",
  "from": "daemon-id",
  "to": "client-id",
  "payload": "{\"success\":false,\"error\":\"配对码无效或已过期\"}",
  "timestamp": 1234567890
}
```

---

### message - 加密消息

**发送方：** Daemon / Client
**接收方：** Client / Daemon

```json
{
  "type": "message",
  "from": "sender-id",
  "to": "receiver-id",
  "payload": "base64-encrypted-data",
  "timestamp": 1234567890
}
```

payload 是使用 AES-256-GCM 加密的应用层消息。

---

### heartbeat - 心跳

**发送方：** Daemon / Client
**接收方：** Relay

```json
{
  "type": "heartbeat",
  "from": "device-id",
  "payload": "",
  "timestamp": 1234567890
}
```

---

### error - 错误

**发送方：** Relay
**接收方：** Daemon / Client

```json
{
  "type": "error",
  "from": "relay",
  "to": "device-id",
  "payload": "{\"code\":\"PEER_DISCONNECTED\",\"message\":\"配对设备已断开连接\"}",
  "timestamp": 1234567890
}
```

---

## 应用层协议

应用层消息使用 AES-256-GCM 加密后放入传输层的 payload 字段。

### 基础结构

```typescript
interface AppMessage {
  action: AppMessageAction;
  messageId?: string;
}

type AppMessageAction =
  | 'session:create'
  | 'session:created'
  | 'session:list'
  | 'session:list_response'
  | 'session:close'
  | 'session:closed'
  | 'session:input'
  | 'session:output'
  | 'session:resize'
  | 'permission:request'
  | 'permission:respond'
  | 'error';
```

---

## 会话管理消息

### session:create - 创建会话

**发送方：** Client
**接收方：** Daemon

```typescript
{
  action: 'session:create',
  messageId: 'msg-123',
  sessionType: 'claude' | 'terminal',
  options?: {
    // Claude 会话选项
    cwd?: string;
    model?: string;
    initialPrompt?: string;
    // 终端会话选项
    shell?: string;
    cols?: number;
    rows?: number;
  }
}
```

---

### session:created - 会话已创建

**发送方：** Daemon
**接收方：** Client

```typescript
{
  action: 'session:created',
  messageId: 'msg-124',
  session: {
    id: 'session-uuid',
    type: 'claude' | 'terminal',
    status: 'running',
    createdAt: 1234567890,
    title: 'Claude: project-name'
  }
}
```

---

### session:list - 列出会话

**发送方：** Client
**接收方：** Daemon

```typescript
{
  action: 'session:list',
  messageId: 'msg-125'
}
```

---

### session:list_response - 会话列表响应

**发送方：** Daemon
**接收方：** Client

```typescript
{
  action: 'session:list_response',
  messageId: 'msg-126',
  sessions: [
    {
      id: 'session-1',
      type: 'claude',
      status: 'running',
      createdAt: 1234567890,
      title: 'Claude: project-a'
    },
    {
      id: 'session-2',
      type: 'terminal',
      status: 'running',
      createdAt: 1234567891,
      title: 'bash'
    }
  ]
}
```

---

### session:close - 关闭会话

**发送方：** Client
**接收方：** Daemon

```typescript
{
  action: 'session:close',
  messageId: 'msg-127',
  sessionId: 'session-uuid'
}
```

---

### session:closed - 会话已关闭

**发送方：** Daemon
**接收方：** Client

```typescript
{
  action: 'session:closed',
  messageId: 'msg-128',
  sessionId: 'session-uuid',
  reason?: 'Client requested' | 'Session exited'
}
```

---

## 会话交互消息

### session:input - 会话输入

**发送方：** Client
**接收方：** Daemon

```typescript
{
  action: 'session:input',
  messageId: 'msg-129',
  sessionId: 'session-uuid',
  data: '用户输入的文本\n'
}
```

---

### session:output - 会话输出

**发送方：** Daemon
**接收方：** Client

```typescript
{
  action: 'session:output',
  messageId: 'msg-130',
  sessionId: 'session-uuid',
  data: 'Claude 的回复或终端输出（可能包含 ANSI 转义序列）'
}
```

---

### session:resize - 终端尺寸调整

**发送方：** Client
**接收方：** Daemon

```typescript
{
  action: 'session:resize',
  messageId: 'msg-131',
  sessionId: 'session-uuid',
  cols: 120,
  rows: 40
}
```

---

## 权限审批消息

### permission:request - 权限请求

**发送方：** Daemon
**接收方：** Client

```typescript
{
  action: 'permission:request',
  messageId: 'msg-132',
  request: {
    id: 'request-uuid',
    sessionId: 'session-uuid',
    tool: 'bash',
    description: '执行命令: rm -rf /tmp/cache',
    status: 'pending',
    requestedAt: 1234567890
  }
}
```

---

### permission:respond - 权限响应

**发送方：** Client
**接收方：** Daemon

```typescript
{
  action: 'permission:respond',
  messageId: 'msg-133',
  sessionId: 'session-uuid',
  requestId: 'request-uuid',
  approved: true | false
}
```

---

## 错误消息

### error - 应用层错误

```typescript
{
  action: 'error',
  messageId: 'msg-134',
  code: 'SESSION_CREATE_FAILED' | 'SESSION_NOT_FOUND' | ...,
  message: '创建会话失败: 无法启动 Claude 进程',
  relatedMessageId?: 'msg-123'  // 关联的请求消息 ID
}
```

---

## 错误码

| 错误码 | 描述 |
|--------|------|
| `INVALID_MESSAGE` | 无效的消息格式 |
| `DEVICE_NOT_REGISTERED` | 设备未注册 |
| `DEVICE_NOT_PAIRED` | 设备未配对 |
| `PAIRING_CODE_INVALID` | 配对码无效 |
| `PAIRING_CODE_EXPIRED` | 配对码已过期 |
| `SESSION_CREATE_FAILED` | 创建会话失败 |
| `SESSION_NOT_FOUND` | 会话不存在 |
| `PERMISSION_DENIED` | 权限被拒绝 |
| `PEER_DISCONNECTED` | 配对设备已断开 |
| `ENCRYPTION_ERROR` | 加密/解密失败 |

---

## 加密细节

### 密钥交换

使用 ECDH P-256 曲线进行密钥交换：

1. 各方生成 ECDH 密钥对
2. 配对时交换公钥
3. 使用 ECDH 派生共享密钥
4. 派生 AES-256 密钥

### 消息加密

使用 AES-256-GCM：

```
加密数据格式: IV(12字节) + 密文 + AuthTag(16字节)
```

编码为 Base64 后作为 payload 发送。

### 密钥派生

```typescript
// 从 ECDH 共享密钥派生 AES 密钥
const aesKey = await crypto.subtle.deriveKey(
  {
    name: 'ECDH',
    public: remotePublicKey
  },
  localPrivateKey,
  {
    name: 'AES-GCM',
    length: 256
  },
  false,
  ['encrypt', 'decrypt']
);
```
