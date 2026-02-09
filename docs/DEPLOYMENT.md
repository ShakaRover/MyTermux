# MyCC 部署文档

## 部署架构

```
┌─────────────────────────────────────────────────────────────────┐
│                           VPS 服务器                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Nginx (反向代理)                        │  │
│  │  - HTTPS 证书管理                                          │  │
│  │  - WSS 代理                                                │  │
│  └─────────────────────────┬─────────────────────────────────┘  │
│                            │                                     │
│  ┌─────────────────────────▼─────────────────────────────────┐  │
│  │                   Relay 服务器                             │  │
│  │  - HTTP: localhost:3000                                    │  │
│  │  - WebSocket: localhost:3000/ws                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   Web 静态文件                             │  │
│  │  - 由 Nginx 直接服务                                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 环境准备

### VPS 要求

- **操作系统**: Ubuntu 22.04 LTS 或更高版本
- **内存**: 最低 512MB，建议 1GB+
- **存储**: 最低 10GB
- **网络**: 需要公网 IP 和域名

### 安装基础软件

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装必要软件
sudo apt install -y curl wget git nginx certbot python3-certbot-nginx

# 安装 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 安装 pnpm
npm install -g pnpm
```

## Relay 服务器部署

### 1. 获取代码

```bash
# 创建应用目录
sudo mkdir -p /opt/mycc
sudo chown $USER:$USER /opt/mycc

# 克隆代码
cd /opt/mycc
git clone <repository-url> .

# 安装依赖
pnpm install

# 构建
pnpm turbo run build
```

### 2. 创建 Systemd 服务

创建服务文件 `/etc/systemd/system/mycc-relay.service`：

```ini
[Unit]
Description=MyCC Relay Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/mycc/packages/relay
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

### 3. 启动服务

```bash
# 重新加载 systemd
sudo systemctl daemon-reload

# 启动服务
sudo systemctl start mycc-relay

# 设置开机自启
sudo systemctl enable mycc-relay

# 查看状态
sudo systemctl status mycc-relay

# 查看日志
sudo journalctl -u mycc-relay -f
```

## Nginx 配置

### 1. 获取 SSL 证书

```bash
# 使用 Certbot 获取证书
sudo certbot --nginx -d relay.yourdomain.com
```

### 2. 配置反向代理

创建配置文件 `/etc/nginx/sites-available/mycc`：

```nginx
# HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name relay.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS 配置
server {
    listen 443 ssl http2;
    server_name relay.yourdomain.com;

    # SSL 证书
    ssl_certificate /etc/letsencrypt/live/relay.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 健康检查
    location /health {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # HTTP API
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket 代理
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

### 3. 启用配置

```bash
# 启用站点
sudo ln -s /etc/nginx/sites-available/mycc /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl reload nginx
```

## Web 前端部署

### 选项 1: 与 Relay 同服务器

```bash
# 构建 Web
cd /opt/mycc/packages/web
pnpm build

# 复制到 Nginx 目录
sudo cp -r dist/* /var/www/mycc-web/
```

配置 Nginx 服务静态文件：

```nginx
server {
    listen 443 ssl http2;
    server_name app.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/app.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.yourdomain.com/privkey.pem;

    root /var/www/mycc-web;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 缓存静态资源
    location /assets {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### 选项 2: 部署到 Vercel/Netlify

1. 将代码推送到 GitHub
2. 在 Vercel/Netlify 创建项目
3. 配置构建命令：
   ```
   Build Command: pnpm --filter @mycc/web build
   Output Directory: packages/web/dist
   ```
4. 配置环境变量（如需要）

## Docker 部署

### Dockerfile (Relay)

创建 `packages/relay/Dockerfile`：

```dockerfile
FROM node:20-alpine

WORKDIR /app

# 复制必要文件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/shared ./packages/shared
COPY packages/relay ./packages/relay

# 安装依赖
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# 构建
RUN pnpm turbo run build --filter=@mycc/relay

# 运行
WORKDIR /app/packages/relay
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Docker Compose

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  relay:
    build:
      context: .
      dockerfile: packages/relay/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 运行

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f relay
```

## 安全最佳实践

### 1. 防火墙配置

```bash
# 安装 ufw
sudo apt install ufw

# 默认策略
sudo ufw default deny incoming
sudo ufw default allow outgoing

# 允许 SSH
sudo ufw allow ssh

# 允许 HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 启用防火墙
sudo ufw enable
```

### 2. 限制 Relay 端口访问

只允许本地访问 3000 端口，外部通过 Nginx 代理：

```bash
# 确保 relay 只监听本地
# 在服务配置中添加
Environment=HOST=127.0.0.1
```

### 3. 日志监控

```bash
# 配置日志轮转
sudo tee /etc/logrotate.d/mycc << EOF
/var/log/mycc/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data www-data
}
EOF
```

### 4. 定期更新

```bash
# 创建更新脚本
sudo tee /opt/mycc/update.sh << 'EOF'
#!/bin/bash
cd /opt/mycc
git pull
pnpm install
pnpm turbo run build
sudo systemctl restart mycc-relay
EOF

chmod +x /opt/mycc/update.sh
```

## 监控

### 健康检查

```bash
# 检查服务状态
curl https://relay.yourdomain.com/health
```

响应示例：
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

### 日志分析

```bash
# 实时查看日志
sudo journalctl -u mycc-relay -f

# 查看最近错误
sudo journalctl -u mycc-relay --since "1 hour ago" | grep -i error
```

## 备份与恢复

### 备份配置

```bash
# 备份 Nginx 配置
sudo cp -r /etc/nginx/sites-available/mycc /backup/

# 备份 SSL 证书
sudo cp -r /etc/letsencrypt /backup/
```

### 恢复服务

```bash
# 恢复代码
cd /opt/mycc
git checkout main
pnpm install
pnpm turbo run build

# 重启服务
sudo systemctl restart mycc-relay
sudo systemctl restart nginx
```

## 故障排除

### 服务无法启动

```bash
# 检查日志
sudo journalctl -u mycc-relay -n 50

# 检查端口占用
sudo lsof -i :3000

# 检查权限
ls -la /opt/mycc
```

### WebSocket 连接失败

```bash
# 测试 WebSocket
wscat -c wss://relay.yourdomain.com/ws

# 检查 Nginx 错误日志
sudo tail -f /var/log/nginx/error.log
```

### SSL 证书问题

```bash
# 检查证书有效期
sudo certbot certificates

# 手动续期
sudo certbot renew

# 测试续期
sudo certbot renew --dry-run
```
