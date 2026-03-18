# MyTermux 服务协议流转图

本文聚焦 Relay / Web / Daemon 的关键协议链路，便于排查认证与路由问题。  
部署约束：本地/测试统一无证书（HTTP + WS）；生产必须走 Nginx 反向代理并启用证书（HTTPS + WSS）。  
默认地址：Web Client `127.0.0.1:62100`，Relay `127.0.0.1:62200`，Daemon 本地状态监听 `127.0.0.1:62300`。

## 1. 总体链路（HTTP + WebSocket）

```mermaid
flowchart LR
  W[Web 前端]
  WB[(Web 本地数据库<br/>IndexedDB: mytermux_web_db)]
  R[Relay]
  RB[(relay.db)]
  D[Daemon]
  DB[(daemon.db)]

  W <-->|本地登录/偏好| WB
  W -->|管理 API + x-mytermux-web-link-token| R
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

## 2. Web 本地登录 + Relay 管理 API

```mermaid
sequenceDiagram
  participant W as Web 前端
  participant WB as Web 本地数据库
  participant R as Relay
  participant RB as relay.db

  W->>WB: 读取账号(默认 admin/mytermux)
  W->>WB: 登录校验(首次登录强制改密)
  WB-->>W: 登录成功

  W->>WB: 读取 relayUrl/webLinkToken
  W->>R: GET /api/daemons + x-mytermux-web-link-token
  R->>RB: 同步在线 daemon 与 profile
  RB-->>R: profiles
  R-->>W: onlineDaemons + profiles

  W->>R: PATCH /api/daemon-profiles/:id
  R->>RB: 更新 profile
  RB-->>R: profile
  R-->>W: profile

  W->>R: POST /api/ws-ticket(profileId)
  R->>R: 校验 MYTERMUX_WEB_LINK_TOKEN(开启时)
  R->>RB: 读取 profile + 解密 daemon token
  RB-->>R: daemonToken/daemonId
  R-->>W: ticket(60s, 一次性)
```

## 3. WebSocket 注册、Token 认证与消息转发

```mermaid
sequenceDiagram
  participant D as Daemon
  participant C as Web 前端(会话阶段)
  participant R as Relay

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

- Web 登录不依赖 Relay，不请求 `/api/web-auth/*`。
- 当 Relay 开启 `MYTERMUX_WEB_LINK_TOKEN` 时，管理 API 与 ws-ticket 都需要提供正确 token。
- Client 连接 `/ws` 前必须先拿 `ws-ticket`，ticket 仅可消费一次，默认 60 秒过期。
- `token_auth` 仅允许 `deviceType=client`。
- `message/heartbeat` 的 `from` 必须与 ws 绑定 `deviceId` 一致，否则会被拒绝并断开。
- 只有通过 `MYTERMUX_DAEMON_TOKEN` 认证建立关系的 daemon/client 才允许消息路由。
