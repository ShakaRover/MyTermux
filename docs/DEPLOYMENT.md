# OpenTermux 部署文档

目标：部署可长期运行的 OpenTermux（Relay + Daemon + Web）。

## 1. 基础要求

- Node.js >= 20
- pnpm >= 9
- 建议 Linux + systemd
- 生产环境建议 HTTPS/TLS

## 2. 构建

```bash
pnpm install
pnpm turbo run build
```

## 3. Relay 部署

## 3.1 必要环境变量

- `RELAY_ADMIN_USERNAME`：Web 管理员用户名
- `RELAY_ADMIN_PASSWORD_HASH`：管理员密码哈希（格式 `scrypt$N$r$p$saltB64$hashB64`）
- `RELAY_WEB_MASTER_KEY`：加密 daemon profile token 的主密钥（建议 32 字节随机）
- `RELAY_DB_PATH`：SQLite 文件路径（默认 `~/.opentermux/relay.db`）

示例：

```bash
export RELAY_ADMIN_USERNAME=admin
export RELAY_ADMIN_PASSWORD_HASH='<scrypt-hash>'
export RELAY_WEB_MASTER_KEY='<32-byte-random-secret>'
export RELAY_DB_PATH=/var/lib/opentermux/relay.db
```

## 3.2 生成密码哈希

```bash
node -e "const {randomBytes,scryptSync}=require('node:crypto');const p=process.argv[1];const s=randomBytes(16);const N=16384,r=8,pv=1;const h=scryptSync(p,s,64,{N,r,p:pv});console.log(['scrypt',N,r,pv,s.toString('base64'),h.toString('base64')].join('$'));" 'your-password'
```

## 3.3 启动 Relay

前台验证：

```bash
pnpm --filter @opentermux/relay start:fg -- --host 0.0.0.0 --port 3000
```

后台运行：

```bash
pnpm --filter @opentermux/relay start
```

健康检查：

```bash
curl http://127.0.0.1:3000/health
```

## 4. Daemon 部署

在被控主机运行：

```bash
pnpm --filter @opentermux/daemon start -- --relay ws://<relay-host>:3000
```

查看 token：

```bash
pnpm --filter @opentermux/daemon token
```

## 5. Web 部署

```bash
pnpm --filter @opentermux/web build
```

产物目录：`packages/web/dist`

建议与 relay 同域部署（便于 Cookie/CSRF 同域策略）。

## 6. Nginx 示例

```nginx
server {
  listen 443 ssl;
  server_name opentermux.example.com;

  ssl_certificate     /etc/letsencrypt/live/opentermux.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/opentermux.example.com/privkey.pem;

  location / {
    root /srv/opentermux/web-dist;
    try_files $uri /index.html;
  }

  location /api {
    proxy_pass http://127.0.0.1:3000/api;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location /ws {
    proxy_pass http://127.0.0.1:3000/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /health {
    proxy_pass http://127.0.0.1:3000/health;
  }
}
```

## 7. systemd 示例

### 7.1 relay.service

```ini
[Unit]
Description=OpenTermux Relay
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/opentermux
ExecStart=/usr/bin/pnpm --filter @opentermux/relay start:fg -- --host 0.0.0.0 --port 3000
Restart=always
RestartSec=3
User=opentermux
Environment=NODE_ENV=production
Environment=RELAY_ADMIN_USERNAME=admin
Environment=RELAY_ADMIN_PASSWORD_HASH=<scrypt-hash>
Environment=RELAY_WEB_MASTER_KEY=<master-key>
Environment=RELAY_DB_PATH=/var/lib/opentermux/relay.db

[Install]
WantedBy=multi-user.target
```

### 7.2 daemon.service

```ini
[Unit]
Description=OpenTermux Daemon
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/opentermux
ExecStart=/usr/bin/pnpm --filter @opentermux/daemon start:fg -- --relay wss://opentermux.example.com/ws
Restart=always
RestartSec=3
User=opentermux
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

## 8. 安全建议

- Relay 必须在 TLS 环境运行
- 不要在生产环境使用默认管理员配置
- `RELAY_WEB_MASTER_KEY` 必须高强度随机并妥善保管
- daemon token 仅通过可信渠道分发
- 定期轮换 daemon token
- 监控登录失败与锁定事件

## 9. 运行时文件

默认目录：`~/.opentermux`

- `auth.json`
- `daemon.pid`
- `daemon.status`
- `relay.pid`
- `relay.log`
- `relay.db`

## 10. 历史数据说明

本版本不会自动迁移或删除历史版本目录，如需迁移请手动执行。
