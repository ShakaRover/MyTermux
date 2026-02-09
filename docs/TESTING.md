# MyCC 测试文档

## 测试策略

MyCC 项目采用分层测试策略：

1. **单元测试** - 测试独立模块的功能
2. **集成测试** - 测试模块间的交互
3. **端到端测试** - 测试完整用户流程

## 测试工具

- **测试框架**: Vitest
- **断言库**: Vitest 内置
- **E2E 测试**: Playwright (规划中)

## 运行测试

```bash
# 运行所有测试
pnpm turbo run test

# 监听模式
pnpm turbo run test:watch

# 运行特定包的测试
pnpm --filter @mycc/shared test

# 查看覆盖率
pnpm --filter @mycc/shared test -- --coverage
```

## 测试覆盖

### shared 包

| 模块 | 测试文件 | 测试数量 | 覆盖内容 |
|------|----------|----------|----------|
| crypto | crypto.test.ts | 11 | 密钥生成、加密解密、密钥交换 |
| protocol | protocol.test.ts | 9 | 消息创建、类型守卫、消息ID生成 |

### 单元测试示例

#### 加密模块测试

```typescript
// tests/crypto.test.ts
import { describe, it, expect } from 'vitest';
import {
  generateKeyPair,
  deriveSharedSecret,
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
} from '../src/crypto';

describe('加密模块', () => {
  describe('密钥对生成', () => {
    it('应该生成有效的密钥对', async () => {
      const keyPair = await generateKeyPair();

      expect(keyPair).toHaveProperty('publicKey');
      expect(keyPair).toHaveProperty('privateKey');
      expect(typeof keyPair.publicKey).toBe('string');
      expect(keyPair.publicKey.length).toBeGreaterThan(0);
    });

    it('每次生成的密钥对应该不同', async () => {
      const keyPair1 = await generateKeyPair();
      const keyPair2 = await generateKeyPair();

      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
    });
  });

  describe('加密解密', () => {
    it('加密后解密应该得到原始数据', async () => {
      const keyPair = await generateKeyPair();
      const sharedKey = await deriveSharedSecret(
        keyPair.privateKey,
        keyPair.publicKey
      );

      const plaintext = '敏感数据';
      const encrypted = await encrypt(sharedKey, plaintext);
      const decrypted = await decrypt(sharedKey, encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });
});
```

#### 协议测试

```typescript
// tests/protocol.test.ts
import { describe, it, expect } from 'vitest';
import {
  createTransportMessage,
  generateMessageId,
  isTransportMessage,
  isAppMessage,
} from '../src/protocol';

describe('协议模块', () => {
  describe('createTransportMessage', () => {
    it('应该创建有效的传输层消息', () => {
      const message = createTransportMessage(
        'message',
        'device-123',
        'encrypted-payload',
        'device-456'
      );

      expect(message.type).toBe('message');
      expect(message.from).toBe('device-123');
      expect(message.to).toBe('device-456');
      expect(message.payload).toBe('encrypted-payload');
      expect(typeof message.timestamp).toBe('number');
    });
  });

  describe('类型守卫', () => {
    it('isTransportMessage 应该正确识别传输层消息', () => {
      const valid = {
        type: 'message',
        from: 'a',
        timestamp: Date.now(),
        payload: ''
      };
      const invalid = { type: 'message' };

      expect(isTransportMessage(valid)).toBe(true);
      expect(isTransportMessage(invalid)).toBe(false);
    });
  });
});
```

## 编写新测试

### 测试文件命名

- 单元测试: `*.test.ts`
- 集成测试: `*.integration.test.ts`
- E2E 测试: `*.e2e.test.ts`

### 测试结构

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('模块名称', () => {
  // 设置和清理
  beforeEach(() => {
    // 每个测试前执行
  });

  afterEach(() => {
    // 每个测试后执行
  });

  describe('功能分组', () => {
    it('应该满足某个条件', () => {
      // 准备
      const input = 'test';

      // 执行
      const result = someFunction(input);

      // 验证
      expect(result).toBe('expected');
    });
  });
});
```

## 集成测试规划

### Daemon ↔ Relay 测试

```typescript
describe('Daemon-Relay 集成', () => {
  it('应该成功注册设备', async () => {
    // 启动 relay
    // 连接 daemon
    // 验证注册成功
  });

  it('应该正确处理配对流程', async () => {
    // 生成配对码
    // 客户端发起配对
    // 验证配对成功
  });
});
```

### 消息路由测试

```typescript
describe('消息路由', () => {
  it('应该正确路由消息到目标设备', async () => {
    // 配对两个设备
    // 从设备A发送消息
    // 验证设备B收到消息
  });
});
```

## E2E 测试规划

### 测试场景

1. **配对流程**
   - 打开 Web 界面
   - 输入有效配对码
   - 验证配对成功

2. **会话管理**
   - 创建 Claude 会话
   - 发送消息
   - 查看回复

3. **终端操作**
   - 创建终端会话
   - 执行命令
   - 查看输出

4. **权限审批**
   - 触发权限请求
   - 审批/拒绝
   - 验证结果

## 验证清单

- [ ] `mycc start` 启动 daemon 并显示配对码
- [ ] Web 输入配对码成功配对
- [ ] Web 新建 Claude 会话，本地 claude 进程启动
- [ ] Web 发消息，Claude 收到并回复，Web 实时显示
- [ ] Claude 请求权限 → Web 弹出审批框 → 批准后继续
- [ ] Web 新建终端，输入命令，输出正确显示
- [ ] Web 关闭会话，本地进程正确终止
- [ ] 断网后重连自动恢复
- [ ] `mycc status` 显示所有活跃会话
- [ ] `mycc stop` 正确关闭所有会话和 daemon

## 测试最佳实践

1. **隔离性** - 每个测试应该独立运行
2. **可重复性** - 测试结果应该稳定
3. **快速性** - 避免不必要的等待
4. **明确性** - 测试名称清晰描述测试内容
5. **完整性** - 覆盖正常和异常场景
