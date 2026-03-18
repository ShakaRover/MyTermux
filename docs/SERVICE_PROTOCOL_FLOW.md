# MyTermux 服务协议流转图

本文聚焦 Relay / Web / Daemon 的关键协议链路，便于排查认证与路由问题。
说明：`Web 管理端` 与 `Web Client` 在实现上是同一个 Web 前端，这里仅按阶段区分职责。
部署约束：本地/测试统一无证书（HTTP + WS）；生产必须走 Nginx 反向代理并启用证书（HTTPS + WSS）。
默认地址：Web Client `127.0.0.1:62100`，Relay `127.0.0.1:62200`，Daemon 本地状态监听 `127.0.0.1:62300`。

## 1. 总体链路（HTTP + WebSocket）

```mermaid
flowchart LR
  A[Web 前端]
  B[Relay]
  D[Daemon]

  A -->|登录认证| B
  A -->|获取 CSRF| B
  A -->|查询 Daemon 与 Profile| B
  A -->|签发 ws-ticket + MYTERMUX_WEB_LINK_TOKEN 校验| B

  A -->|携带 ticket 建立 WS| B
  D -->|注册并上报 MYTERMUX_DAEMON_LINK_TOKEN| B
  D -->|注册并上报 MYTERMUX_DAEMON_TOKEN| B

  A -->|token_auth| B
  B -->|token_ack| A
  A -->|message / heartbeat| B
  B -->|message / heartbeat| D
```

## 2. Web 登录与 ws-ticket 签发

```mermaid
sequenceDiagram
  participant W as Web 前端（管理阶段）
  participant R as Relay
  participant DB as relay.db

  W->>R: POST /api/web-auth/login (username/password)
  R->>DB: 校验用户名密码 + 暴力破解策略
  DB-->>R: 通过
  R-->>W: 200 + session cookie + csrf cookie

  W->>R: GET /api/web-auth/csrf
  R-->>W: csrfToken

  W->>R: POST /api/ws-ticket (profileId, webLinkToken, X-CSRF-Token)
  R->>R: 校验 MYTERMUX_WEB_LINK_TOKEN（开启时）
  R->>DB: 读取 profile + 解密 accessToken
  DB-->>R: MYTERMUX_DAEMON_TOKEN / daemonId
  R-->>W: ticket(60s, 一次性)
```

## 3. WebSocket 注册、Token 认证与消息转发

```mermaid
sequenceDiagram
  participant D as Daemon
  participant C as Web 前端（会话阶段）
  participant R as Relay

  D->>R: register(deviceType=daemon, daemonLinkToken, daemonToken, publicKey)
  R->>R: 校验 MYTERMUX_DAEMON_LINK_TOKEN（开启时）
  R-->>D: register ack

  C->>R: 连接 /ws?ticket=...
  C->>R: token_auth(deviceType=client, publicKey, [daemonToken])
  R->>R: 校验 ws-ticket（一次性/60s）
  R->>R: 取 token = ticketToken 优先，否则 payload.daemonToken
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

  C->>R: message(from=clientId, to=daemonId, payload)
  R->>R: 校验 from 与 ws 绑定 deviceId 一致
  R->>R: 校验双方已建立认证关系
  R-->>D: message

  D->>R: heartbeat(from=daemonId)
  R->>R: 校验 from 与 ws 绑定 deviceId 一致
  R-->>D: heartbeat ack
```

## 4. 关键约束（排障优先看）

- Client 连接 `/ws` 前必须先拿 `ws-ticket`，ticket 仅可消费一次，默认 60 秒过期；可配置 `MYTERMUX_WEB_LINK_TOKEN` 二次校验。
- `token_auth` 仅允许 `deviceType=client`。
- 若 ticket 中已有 token，且 payload 另传 token 且不一致，会被拒绝（`TOKEN_MISMATCH`）。
- 可配置 `MYTERMUX_DAEMON_LINK_TOKEN` 强制 daemon 链路授权。
- `message/heartbeat` 的 `from` 必须与该 ws 已绑定 `deviceId` 一致，否则会被拒绝并断开连接。
- 只有通过 `MYTERMUX_DAEMON_TOKEN` 认证建立关系的 daemon/client 才允许消息路由。
