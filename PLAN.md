# OpenTermux 计划（1.0 基线）

## 目标

将项目稳定为 OpenTermux 的 Web 远程终端基线，保证命名、协议、实现与文档一致。

## 当前基线

- 品牌与命令：`OpenTermux` / `opentermux` / `opentermux-relay`
- 包作用域：`@opentermux/*`
- Token 前缀：`opentermux-`
- 本地目录：`~/.opentermux`
- 认证文件：`auth.json`
- 认证流程：`token_auth` / `token_ack`
- 会话模型：仅 `terminal`

## 已完成

1. 全仓品牌与命令统一
2. 认证术语统一为 `auth`
3. 前端认证页重命名为 `AuthPage`
4. 连接状态统一为 `authenticating` / `authenticated`
5. 终端优先收敛，移除非终端会话模型
6. 协议收敛，移除过期权限请求链路
7. 版本升级：根与各包统一到 `1.0.0`
8. 文档与示例更新：统一命令、路径、协议

## 发布约束（Breaking）

- 不保留历史兼容命令
- 不保留历史认证路由
- 不自动迁移历史版本目录
- 不保留历史认证协议描述

## 验收门禁

```bash
pnpm install
pnpm turbo run clean
pnpm turbo run build typecheck test
rg -n --glob '!node_modules' 'token_auth|token_ack|opentermux-|@opentermux/'
```

## 下一步建议

1. 增加 daemon/web 单元测试覆盖率
2. 增加端到端场景测试（认证 + 终端 I/O + 重连）
3. 为生产部署补充监控与告警模板
