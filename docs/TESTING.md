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
- `relay`: registry、websocket-handler、密码哈希、暴力破解、ws-ticket
- `daemon`: `TerminalSession` 的 `pid/startupCommand`

## 2. 手工冒烟

### 2.1 启动组件

```bash
pnpm --filter @mytermux/relay start:fg
pnpm --filter @mytermux/daemon start:fg
pnpm --filter @mytermux/web dev
```

### 2.2 Web 登录与管理

1. 打开 `http://localhost:5173/login`
2. 使用管理员账号登录
3. 在 `/daemons` 验证在线 daemon 自动生成 profile
4. 验证在线 profile 可编辑，离线 profile 可手动删除（无新增入口）
5. 让 daemon 离线，验证 profile 保留且支持手动删除
6. 点击“连接”进入 `/sessions`

### 2.3 终端会话

1. 验证进入 `/sessions` 后不会自动新建会话
2. 手动新建会话并发送输入
3. 校验会话列表显示 `PID`
4. 调整窗口，验证 resize 正常
5. 关闭会话，验证列表同步

### 2.4 移动端快捷栏

1. 在触屏设备打开 `/sessions`
2. 聚焦终端并弹出软键盘
3. 验证快捷栏出现
4. 点击快捷键后终端收到输入
5. 在 `/daemons` 修改快捷键配置后刷新验证生效

## 3. 协议与命名扫描

```bash
rg -n --glob '!node_modules' 'token_auth|token_ack|mytermux-|mytermux_web_session|ws-ticket'
```

期望：核心协议、命名与实现一致。

## 4. 验收清单

- [ ] `build/typecheck/test` 全绿
- [ ] Web 未登录不可操作 daemon 与会话
- [ ] 登录后可查看在线 daemon 与 profile 并连接
- [ ] ws-ticket 过期/复用会被拒绝
- [ ] 会话列表显示 PID
- [ ] 移动端快捷栏按条件显示且可配置
