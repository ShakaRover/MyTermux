# MyTermux 测试文档

## 1. 自动化验证

### 1.1 全量

```bash
pnpm turbo run build typecheck test
```

### 1.2 包级

```bash
pnpm --filter @mytermux/shared test
pnpm --filter @mytermux/relay test
pnpm --filter @mytermux/daemon test
pnpm --filter @mytermux/web test
```

当前覆盖重点：

- `shared`: 协议/加密
- `relay`: registry、websocket-handler、ws-ticket、profile API
- `daemon`: `TerminalSession` 的 `pid/startupCommand`
- `web`: 登录状态、会话状态、连接 URL

## 2. 手工冒烟

约束：测试环境统一无证书模型（HTTP + WS），不要配置 `TLS_CERT` / `TLS_KEY`，不要启用 `VITE_HTTPS`。

### 2.1 启动组件

```bash
cp .env.example .env
pnpm start:local:test
```

### 2.2 Web 登录与管理

1. 打开 `http://127.0.0.1:62100/login`
2. 使用默认账号密码 `admin` / `mytermux` 登录
3. 首次登录必须进入账号初始化页并修改账号和密码
4. 关闭浏览器后重新打开，使用新账号密码应仍可登录（验证 `web.db` 持久化）
4. 完成账号初始化后，在 `/daemons` 验证在线 daemon 自动生成 profile
5. 验证在线 profile 可编辑，离线 profile 可手动删除（无新增入口）
6. 验证可在 Web 端保存 Relay 地址与 `MYTERMUX_WEB_LINK_TOKEN` 配置
7. 点击“连接”进入 `/sessions`

### 2.3 Relay 鉴权验证（开启 `MYTERMUX_WEB_LINK_TOKEN` 时）

1. 不带 `x-mytermux-web-link-token` 请求 `/api/daemons`，应返回 401
2. 带错误 token 请求 `/api/daemons`，应返回 401
3. 带正确 token 请求 `/api/daemons`，应返回 200
4. `POST /api/ws-ticket` 带错误 token 应返回 401，正确 token 返回 200

### 2.4 终端会话

1. 验证进入 `/sessions` 后不会自动新建会话
2. 手动新建会话并发送输入
3. 校验会话列表显示 `PID`
4. 调整窗口，验证 resize 正常
5. 关闭会话，验证列表同步

### 2.5 移动端快捷栏

1. 在触屏设备打开 `/sessions`
2. 聚焦终端并弹出软键盘
3. 验证快捷栏出现
4. 点击快捷键后终端收到输入
5. 在 `/daemons` 修改快捷键配置后刷新验证生效

## 3. 协议与命名扫描

```bash
rg -n --glob '!node_modules' 'token_auth|token_ack|mytermux-|ws-ticket|x-mytermux-web-link-token'
```

## 4. 验收清单

- [ ] `build/typecheck/test` 全绿
- [ ] 测试环境全程使用无证书模型（HTTP + WS）
- [ ] Web 登录走服务端 `/api/web-auth/*`，账号会话写入 `web.db`
- [ ] Web 登录后可查看在线 daemon 与 profile 并连接
- [ ] `MYTERMUX_WEB_LINK_TOKEN` 开启时，缺失或错误 token 会拒绝管理 API 与 ws-ticket
- [ ] `MYTERMUX_DAEMON_LINK_TOKEN` 开启时，daemon 链接会被校验
- [ ] ws-ticket 过期/复用会被拒绝
- [ ] 会话列表显示 PID
- [ ] 移动端快捷栏按条件显示且可配置
