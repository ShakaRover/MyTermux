# MyTermux 部署文档

目标：部署可长期运行的 MyTermux（Relay + Daemon + Web）。

## 0. 运行模型（强制约束）

- 本地开发与测试：统一使用无证书模型（HTTP + WS），不配置 `TLS_CERT` / `TLS_KEY`。
- 正式部署：必须通过 Nginx 反向代理并启用有效证书（HTTPS + WSS）。

## 1. 基础要求

- Node.js >= 20
- pnpm >= 9
- 建议 Linux + systemd

## 2. 构建

```bash
pnpm install
pnpm turbo run build
```

## 3. 数据目录与职责

默认目录：`~/.mytermux`

- Relay：`relay.db`（daemon profile）
- Daemon：`daemon.db`（设备身份、token、已认证客户端）
- Web：浏览器 IndexedDB（`mytermux_web_db`）

说明：旧 `~/.mytermux/auth.json` 仅用于 daemon 启动时一次性迁移到 `daemon.db`。

## 4. Relay 部署

### 4.1 必要环境变量

- `MYTERMUX_WEB_LINK_TOKEN`：Web 访问 Relay 管理 API 与 ws-ticket 的鉴权 token（推荐开启）
- `MYTERMUX_DAEMON_LINK_TOKEN`：Daemon 连接 Relay 前置 token（推荐开启）
- `RELAY_WEB_MASTER_KEY`：加密 daemon profile token 的主密钥（建议 32 字节随机）
- `RELAY_DB_PATH`：SQLite 文件路径（默认 `~/.mytermux/relay.db`）

示例：

```bash
export MYTERMUX_WEB_LINK_TOKEN='<web-link-token>'
export MYTERMUX_DAEMON_LINK_TOKEN='<daemon-link-token>'
export RELAY_WEB_MASTER_KEY='<32-byte-random-secret>'
export RELAY_DB_PATH=/var/lib/mytermux/relay.db
```

### 4.2 启动 Relay

说明：生产场景下 Relay 监听内网明文端口（默认 `127.0.0.1:62200`），由 Nginx 负责证书与 TLS。

```bash
pnpm --filter @mytermux/relay start:fg -- --host 127.0.0.1 --port 62200
```

健康检查：

```bash
curl http://127.0.0.1:62200/health
```

## 5. Daemon 部署

在被控主机运行：

```bash
pnpm --filter @mytermux/daemon start -- --relay ws://<relay-host>:62200 --daemon-link-token '<daemon-link-token>'
```

查看 `MYTERMUX_DAEMON_TOKEN`：

```bash
pnpm --filter @mytermux/daemon token
```

Daemon 默认本地监听：`http://127.0.0.1:62300`

## 6. Web 部署

```bash
# 仅当 Relay 开启 MYTERMUX_WEB_LINK_TOKEN 时需要
export VITE_MYTERMUX_WEB_LINK_TOKEN='<web-link-token>'

pnpm --filter @mytermux/web build
```

产物目录：`packages/web/dist`

## 7. Nginx 示例（生产必选）

```nginx
server {
  listen 443 ssl;
  server_name mytermux.example.com;

  ssl_certificate     /etc/letsencrypt/live/mytermux.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/mytermux.example.com/privkey.pem;

  location / {
    root /srv/mytermux/web-dist;
    try_files $uri /index.html;
  }

  location /api {
    proxy_pass http://127.0.0.1:62200/api;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location /ws {
    proxy_pass http://127.0.0.1:62200/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /health {
    proxy_pass http://127.0.0.1:62200/health;
  }
}
```

## 8. systemd 示例

### 8.1 relay.service

```ini
[Unit]
Description=MyTermux Relay
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/mytermux
ExecStart=/usr/bin/pnpm --filter @mytermux/relay start:fg -- --host 127.0.0.1 --port 62200
Restart=always
RestartSec=3
User=mytermux
Environment=NODE_ENV=production
Environment=MYTERMUX_WEB_LINK_TOKEN=<web-link-token>
Environment=MYTERMUX_DAEMON_LINK_TOKEN=<daemon-link-token>
Environment=RELAY_WEB_MASTER_KEY=<master-key>
Environment=RELAY_DB_PATH=/var/lib/mytermux/relay.db

[Install]
WantedBy=multi-user.target
```

### 8.2 daemon.service

```ini
[Unit]
Description=MyTermux Daemon
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/mytermux
ExecStart=/usr/bin/pnpm --filter @mytermux/daemon start:fg -- --relay wss://mytermux.example.com/ws --listen-host 127.0.0.1 --listen-port 62300
Restart=always
RestartSec=3
User=mytermux
Environment=NODE_ENV=production
Environment=MYTERMUX_DAEMON_LINK_TOKEN=<daemon-link-token>

[Install]
WantedBy=multi-user.target
```

## 9. 安全建议

- 本地开发/测试不要配置证书，统一走 HTTP/WS
- 生产必须由 Nginx 提供 TLS，外部流量统一走 HTTPS/WSS
- Web 本地默认账号 `admin` / `mytermux` 仅用于初始化，首次登录必须改密
- `RELAY_WEB_MASTER_KEY` 必须高强度随机并妥善保管
- `MYTERMUX_WEB_LINK_TOKEN` / `MYTERMUX_DAEMON_LINK_TOKEN` 仅通过可信渠道分发
- `MYTERMUX_DAEMON_TOKEN` 仅通过可信渠道分发，并定期轮换

## 10. 历史数据说明

本版本不会自动迁移或删除历史版本目录（daemon 的 `auth.json -> daemon.db` 除外）。
