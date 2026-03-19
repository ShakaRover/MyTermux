# MyTermux 服务协议流转图

本文聚焦 Server / Web / Daemon 的关键协议链路，便于排查认证与路由问题。  
部署约束：本地/测试统一无证书（HTTP + WS）；生产必须走 Nginx 反向代理并启用证书（HTTPS + WSS）。  
默认地址：Web + Server `127.0.0.1:62200`，Daemon 本地状态监听 `127.0.0.1:62300`。

## 1. 总体链路（HTTP + WebSocket）

```mermaid
flowchart LR
  W[Web 前端]
  WB[(Web 本地数据库<br/>IndexedDB: mytermux_web_db)]
  R[Server]
  RB[(relay.db)]
  WA[(web.db)]
  D[Daemon]
  DB[(daemon.db)]

  W <-->|本地偏好| WB
  W -->|/api/web-auth/*| R
  R <-->|账号/会话| WA
  W -->|管理 API + Cookie 会话| R
  R <-->|profile 读写| RB
  D -->|register + daemonLinkToken| R
  D -->|daemonToken| R
  D <-->|设备身份与 token| DB

  W -->|POST /api/ws-ticket| R
  W -->|/ws?ticket=...| R
  W -->|token_auth| R
  R -->|message / heartbeat 路由| D
  D -->|message / heartbeat| R
```

## 2. Web 登录 + Server 管理 API

```mermaid
sequenceDiagram
  participant W as Web 前端
  participant WA as web.db
  participant R as Server
  participant RB as relay.db

  W->>R: POST /api/web-auth/login
  R->>WA: 校验账号与密码哈希
  WA-->>R: 登录通过
  R-->>W: Set-Cookie + 会话信息

  W->>R: GET /api/daemons + Cookie 会话
  R->>RB: 同步在线 daemon 与 profile
  RB-->>R: profiles
  R-->>W: onlineDaemons + profiles

  W->>R: PATCH /api/daemon-profiles/:id
  R->>RB: 更新 profile
  RB-->>R: profile
  R-->>W: profile

  W->>R: POST /api/ws-ticket(profileId)
  R->>R: 校验登录会话
  R->>RB: 读取 profile + 解密 daemon token
  RB-->>R: daemonToken/daemonId
  R-->>W: ticket(60s, 一次性)
```

## 3. WebSocket 注册、Token 认证与消息转发

```mermaid
sequenceDiagram
  participant D as Daemon
  participant C as Web 前端(会话阶段)
  participant R as Server

  D->>R: register(deviceType=daemon, daemonLinkToken, daemonToken, publicKey)
  R->>R: 校验 MYTERMUX_DAEMON_LINK_TOKEN(开启时)
  R-->>D: register ack

  C->>R: 连接 /ws?ticket=...
  C->>R: token_auth(deviceType=client, publicKey, [daemonToken])
  R->>R: 校验 ws-ticket(一次性/60s)
  R->>R: token=ticketToken优先, 否则payload.daemonToken

  alt ticketToken 与 payload.daemonToken 冲突
    R-->>C: error(TOKEN_MISMATCH)
    R-->>C: close(4002)
  else token 缺失
    R-->>C: error(TOKEN_REQUIRED)
    R-->>C: close(4002)
  else token 有效且 daemon 在线
    R-->>C: token_ack(success, daemonId, daemonPublicKey)
    R-->>D: token_ack(success, clientId, clientPublicKey)
  else token 无效或 daemon 离线
    R-->>C: token_ack(success=false)
    R-->>C: close(4001)
  end
```

## 4. 关键约束（排障优先看）

- Web 登录通过 `/api/web-auth/*`，账号与会话写入 `web.db`（不写浏览器本地账号）。
- 管理 API 与 ws-ticket 必须依赖有效 Web 登录会话。
- Client 连接 `/ws` 前必须先拿 `ws-ticket`，ticket 仅可消费一次，默认 60 秒过期。
- `token_auth` 仅允许 `deviceType=client`。
- `message/heartbeat` 的 `from` 必须与 ws 绑定 `deviceId` 一致，否则会被拒绝并断开。
- 只有通过 `MYTERMUX_DAEMON_TOKEN` 认证建立关系的 daemon/client 才允许消息路由。
