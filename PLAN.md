# MyTermux 计划（Web 独立授权版）

## 目标

将 MyTermux 稳定为“Web 登录后管理 daemon 并连接终端”的产品模型。

## 当前基线（已落地）

1. Web 独立认证
- Relay 提供 `/api/web-auth/*`
- 会话方案：`HttpOnly Cookie + CSRF`
- 登录失败防护：IP 限流 + 账号/IP 递增锁定（SQLite 持久化）

2. Daemon 管理中心
- `/daemons` 页面可查看在线 daemon 与 profile
- 支持 profile 新建/编辑/绑定
- profile token 在 Relay 侧加密存储（AES-256-GCM）

3. WebSocket 准入
- 新增 `/api/ws-ticket`（60 秒一次性）
- client 连接 `/ws` 必须携带 ticket
- daemon 保持原注册流程

4. 终端会话增强
- `SessionInfo.pid` 已透传到 Web
- `startupCommand` 已支持默认命令注入
- Dashboard 左侧显示 PID

5. 移动端交互
- 新增终端快捷栏
- 显示条件：触屏 + 终端聚焦 + 软键盘弹出
- 快捷键/常用字符配置存储于 Relay `web_preferences`

## 验收门禁

```bash
pnpm install
pnpm turbo run clean
pnpm turbo run build typecheck test
rg -n --glob '!node_modules' 'mytermux-|token_auth|token_ack|ws-ticket|mytermux_web_session'
```

## 后续迭代建议

1. 增加 Relay API 集成测试（HTTP 路由级）
2. 增加 Web 端到端测试（登录->选 daemon->会话）
3. 增加审计日志（登录失败、profile 变更、连接切换）
4. 增加管理员密码轮换命令
