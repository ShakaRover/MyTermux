# MyTermux 部署文档

目标：部署可长期运行的 MyTermux（Relay + Daemon + Web）。

## 0. 运行模型（强制约束）

- 本地开发与测试：统一使用无证书模型（HTTP + WS），不配置 `TLS_CERT` / `TLS_KEY`。
- 正式部署：必须通过 Nginx 反向代理并启用有效证书（HTTPS + WSS）。

## 1. 基础要求

- Node.js >= 20
- pnpm >= 9
- 建议 Linux + systemd
- 生产环境必须 HTTPS/TLS（由 Nginx 终止 TLS）

## 2. 构建

```bash
pnpm install
pnpm turbo run build
```

## 3. Relay 部署

## 3.1 必要环境变量

- `RELAY_ADMIN_USERNAME`：Web 管理端登录用户名
- `RELAY_ADMIN_PASSWORD_HASH`：Web 管理端登录密码哈希（scrypt 格式）
- `MYTERMUX_WEB_LINK_TOKEN`：Web 前端申请 ws-ticket 前置 token（推荐开启）
- `MYTERMUX_DAEMON_LINK_TOKEN`：Daemon 连接 Relay 前置 token（推荐开启）
- `RELAY_WEB_MASTER_KEY`：加密 daemon profile token 的主密钥（建议 32 字节随机）
- `RELAY_DB_PATH`：SQLite 文件路径（默认 `~/.mytermux/relay.db`）

示例：

```bash
export RELAY_ADMIN_USERNAME='admin'
export RELAY_ADMIN_PASSWORD_HASH='<scrypt-hash>'
export MYTERMUX_WEB_LINK_TOKEN='<web-link-token>'
export MYTERMUX_DAEMON_LINK_TOKEN='<daemon-link-token>'
export RELAY_WEB_MASTER_KEY='<32-byte-random-secret>'
export RELAY_DB_PATH=/var/lib/mytermux/relay.db
```

## 3.2 生成密码哈希

```bash
node -e "const {randomBytes,scryptSync}=require('node:crypto');const p=process.argv[1];const s=randomBytes(16);const N=16384,r=8,pv=1;const h=scryptSync(p,s,64,{N,r,p:pv});console.log(['scrypt',N,r,pv,s.toString('base64'),h.toString('base64')].join('$'));" 'your-password'
```

## 3.3 启动 Relay

说明：生产场景下 Relay 监听内网明文端口（默认 `127.0.0.1:62200`），由 Nginx 负责证书与 TLS。

前台验证：

```bash
pnpm --filter @mytermux/relay start:fg -- --host 127.0.0.1 --port 62200
```

后台运行：

```bash
pnpm --filter @mytermux/relay start
```

健康检查：

```bash
curl http://127.0.0.1:62200/health
```

## 4. Daemon 部署

在被控主机运行：

```bash
pnpm --filter @mytermux/daemon start -- --relay ws://<relay-host>:62200 --daemon-link-token '<daemon-link-token>'
```

查看 `MYTERMUX_DAEMON_TOKEN`：

```bash
pnpm --filter @mytermux/daemon token
```

Daemon 默认本地监听：`http://127.0.0.1:62300`

## 5. Web 部署

```bash
# 仅当 Relay 开启 MYTERMUX_WEB_LINK_TOKEN 时需要
export VITE_MYTERMUX_WEB_LINK_TOKEN='<web-link-token>'

pnpm --filter @mytermux/web build
```

产物目录：`packages/web/dist`

建议与 relay 同域部署（便于 Cookie/CSRF 同域策略）。

## 6. Nginx 示例（生产必选）

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

## 7. systemd 示例

### 7.1 relay.service

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
Environment=RELAY_ADMIN_USERNAME=admin
Environment=RELAY_ADMIN_PASSWORD_HASH=<scrypt-hash>
Environment=MYTERMUX_WEB_LINK_TOKEN=<web-link-token>
Environment=MYTERMUX_DAEMON_LINK_TOKEN=<daemon-link-token>
Environment=RELAY_WEB_MASTER_KEY=<master-key>
Environment=RELAY_DB_PATH=/var/lib/mytermux/relay.db

[Install]
WantedBy=multi-user.target
```

### 7.2 daemon.service

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

## 8. 安全建议

- 本地开发/测试不要配置证书，统一走 HTTP/WS
- 生产必须由 Nginx 提供 TLS，外部流量统一走 HTTPS/WSS
- 不要在生产环境使用默认管理员配置（必须配置 `RELAY_ADMIN_PASSWORD_HASH`）
- `RELAY_WEB_MASTER_KEY` 必须高强度随机并妥善保管
- `MYTERMUX_WEB_LINK_TOKEN` / `MYTERMUX_DAEMON_LINK_TOKEN` 仅通过可信渠道分发
- `MYTERMUX_DAEMON_TOKEN` 仅通过可信渠道分发，并定期轮换
- 监控登录失败与锁定事件

## 9. 运行时文件

默认目录：`~/.mytermux`

- `auth.json`
- `daemon.pid`
- `daemon.status`
- `relay.pid`
- `relay.log`
- `relay.db`

## 10. 历史数据说明

本版本不会自动迁移或删除历史版本目录，如需迁移请手动执行。
