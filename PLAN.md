# MyTermux 计划（职责拆分与一体化链路版）

## 目标

将 MyTermux 稳定为“三端职责清晰、三端数据库隔离、Web/Server 一体化会话鉴权”的模型：

- Web：界面与会话操作（登录走服务端 `web.db`）
- Server：中继 + daemon profile API + WebAuth API
- Daemon：终端执行 + daemon token 持久化

## 当前基线（已落地）

1. Web 服务端认证
- Web 使用 Server `/api/web-auth/*`
- 默认账号 `admin` / `mytermux`，首次登录强制改密
- 登录会话持久化在 `web.db`（Cookie），浏览器仅保存偏好（`mytermux_web_db`）

2. Server API 边界
- 仅保留 `/api/daemons`、`/api/daemon-profiles/:id`、`/api/ws-ticket`
- 管理 API 与 ws-ticket 必须依赖 Web 登录会话（Cookie）

3. Daemon 数据边界
- Daemon 持久化迁移到 `~/.mytermux/daemon.db`
- 保留 `auth.json -> daemon.db` 启动时迁移能力

4. Profile 生命周期
- 在线 daemon 自动建 profile
- 禁止手动新增/绑定 profile
- 离线 profile 保留，允许手动删除

5. 会话链路
- `ws-ticket` 一次性、60 秒有效
- `SessionInfo.pid` 已透传
- `startupCommand` 与移动端快捷键能力保留

## 验收门禁

```bash
pnpm install
pnpm turbo run clean
pnpm turbo run build typecheck test
rg -n --glob '!node_modules' '/api/web-auth|mytermux_web_session|daemon.db|mytermux_web_db|MYTERMUX_DAEMON_LINK_TOKEN'
```

## 后续迭代建议

1. 增加 Web 本地数据库迁移版本管理
2. 增加 Server 管理 API 的会话审计能力
3. 增加 Daemon DB 健康检查与自动备份
