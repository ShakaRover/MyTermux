# OpenTermux 测试文档

## 1. 自动化测试

### 1.1 全量测试

```bash
pnpm turbo run test
```

### 1.2 类型检查

```bash
pnpm turbo run typecheck
```

### 1.3 构建验证

```bash
pnpm turbo run build
```

## 2. 包级测试

```bash
pnpm --filter @opentermux/shared test
pnpm --filter @opentermux/relay test
pnpm --filter @opentermux/daemon test
pnpm --filter @opentermux/web test
```

说明：

- `@opentermux/shared` 与 `@opentermux/relay` 含主要单元测试
- `@opentermux/daemon`、`@opentermux/web` 当前无单测文件，命令会以 `--passWithNoTests` 通过

## 3. 手工冒烟测试

### 3.1 启动组件

```bash
pnpm --filter @opentermux/relay start:fg
pnpm --filter @opentermux/daemon start:fg
pnpm --filter @opentermux/web dev
```

### 3.2 认证流程

1. 浏览器打开 `http://localhost:5173`
2. 输入 `opentermux-` 前缀的 Access Token
3. 认证成功后跳转 Dashboard

### 3.3 终端流程

1. 创建新会话
2. 输入命令（如 `pwd`, `ls`, `echo hello`）
3. 验证输出实时回显
4. 调整浏览器窗口，验证终端 resize 生效
5. 关闭会话，验证列表同步更新

## 4. 协议一致性扫描

执行：

```bash
rg -n --glob '!node_modules' 'token_auth|token_ack|session:create|session:output'
```

期望：

- 协议关键字在实现与文档中一致
- 无过期流程描述

## 5. 验收清单

- [ ] `pnpm turbo run build typecheck test` 全绿
- [ ] Web 可使用 Access Token 成功认证
- [ ] 终端会话创建、输入、输出、关闭正常
- [ ] 文档命令与实际命令一致
- [ ] 协议文档与实现一致（`token_auth` / `token_ack`）
