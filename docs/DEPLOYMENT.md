# OpenTermux 部署文档

## 目标

部署一个可长期运行的 OpenTermux 服务组合：

- Relay（对外网络入口）
- Daemon（运行在被控主机）
- Web（可与 Relay 同域或独立部署）

## 1. 基础准备

- Node.js >= 20
- pnpm >= 9
- Linux 服务器（推荐）
- 可用域名与 TLS 证书（生产环境）

## 2. 构建

```bash
pnpm install
pnpm turbo run build
```

## 3. 部署 Relay

### 3.1 前台验证

```bash
pnpm --filter @opentermux/relay start:fg -- --host 0.0.0.0 --port 3000
```

### 3.2 后台运行

```bash
pnpm --filter @opentermux/relay start
```

### 3.3 健康检查

```bash
curl http://127.0.0.1:3000/health
```

## 4. 部署 Daemon

在需要被远程访问的主机上运行：

```bash
pnpm --filter @opentermux/daemon start -- --relay ws://<relay-host>:3000
```

查看 Token：

```bash
pnpm --filter @opentermux/daemon token
```

## 5. 部署 Web

```bash
pnpm --filter @opentermux/web build
```

构建产物位于：`packages/web/dist`。
可托管到 Nginx、Caddy 或静态托管平台。

## 6. 反向代理示例（Nginx）

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

  location /ws {
    proxy_pass http://127.0.0.1:3000/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
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

- Relay 必须部署在受控网络与 TLS 下
- Access Token 仅通过可信渠道传递
- 定期轮换 Token（daemon 重启或重新生成）
- 限制 relay 暴露面，仅开放必要端口

## 9. 运行时文件

默认目录：`~/.opentermux`

- `auth.json`
- `daemon.pid`
- `daemon.status`
- `relay.pid`
- `relay.log`

## 10. 历史数据说明

本版本不会自动迁移或删除历史版本目录。
如需迁移或清理，请手动执行。
