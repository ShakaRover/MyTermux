/**
 * 配对逻辑
 *
 * 处理 daemon 与 client 之间的配对流程，管理密钥存储
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { PairingInfo, KeyPair } from '@mycc/shared';
import {
  generatePairingCode,
  generateKeyPair,
  deriveSharedSecret,
} from '@mycc/shared';

// ============================================================================
// 类型定义
// ============================================================================

/** 已配对的客户端信息 */
export interface PairedClient {
  /** 客户端设备 ID */
  clientId: string;
  /** 客户端公钥 */
  publicKey: string;
  /** 配对时间戳 */
  pairedAt: number;
  /** 设备名称 */
  name?: string;
}

/** 持久化的配对数据 */
interface PairingData {
  /** Daemon 设备 ID */
  deviceId: string;
  /** 本地公钥 */
  publicKey: string;
  /** 本地私钥（导出格式） */
  privateKeyJwk: JsonWebKey;
  /** 已配对的客户端列表 */
  pairedClients: PairedClient[];
}

/** 配对管理器事件 */
export interface PairingManagerEvents {
  /** 配对码已生成 */
  pairingCodeGenerated: (info: PairingInfo) => void;
  /** 配对成功 */
  pairingSuccess: (client: PairedClient) => void;
  /** 配对失败 */
  pairingFailed: (error: string) => void;
  /** 配对码过期 */
  pairingExpired: () => void;
}

// ============================================================================
// 常量定义
// ============================================================================

/** 配对码有效期（毫秒） */
const PAIRING_CODE_TTL = 5 * 60 * 1000; // 5 分钟

/** 配置文件目录 */
const CONFIG_DIR = path.join(os.homedir(), '.mycc');

/** 配对数据文件路径 */
const PAIRING_DATA_FILE = path.join(CONFIG_DIR, 'pairing.json');

// ============================================================================
// 配对管理器类
// ============================================================================

/**
 * 配对管理器
 *
 * 特性：
 * - 生成和管理配对码
 * - 处理配对流程
 * - 管理密钥存储
 * - 派生共享密钥用于 E2E 加密
 */
export class PairingManager extends EventEmitter {
  /** 当前配对信息 */
  private currentPairing: PairingInfo | null = null;
  /** 配对码过期定时器 */
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  /** 本地密钥对 */
  private keyPair: KeyPair | null = null;
  /** 已配对的客户端 */
  private pairedClients: PairedClient[] = [];
  /** 设备 ID */
  private _deviceId: string = '';
  /** 共享密钥缓存 */
  private sharedKeyCache = new Map<string, CryptoKey>();

  constructor() {
    super();
  }

  // --------------------------------------------------------------------------
  // 公共方法
  // --------------------------------------------------------------------------

  /**
   * 初始化配对管理器
   * 加载或生成密钥对和设备 ID
   */
  async initialize(): Promise<void> {
    await this.ensureConfigDir();

    const existingData = await this.loadPairingData();

    if (existingData) {
      // 恢复现有密钥
      this._deviceId = existingData.deviceId;
      this.pairedClients = existingData.pairedClients;

      // 从 JWK 导入私钥
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        existingData.privateKeyJwk,
        {
          name: 'ECDH',
          namedCurve: 'P-256',
        },
        true,
        ['deriveKey', 'deriveBits']
      );

      this.keyPair = {
        publicKey: existingData.publicKey,
        privateKey,
      };
    } else {
      // 生成新密钥和设备 ID
      this._deviceId = this.generateDeviceId();
      this.keyPair = await generateKeyPair();
      this.pairedClients = [];

      await this.savePairingData();
    }
  }

  /**
   * 生成新的配对码
   * @returns 配对信息
   */
  generateNewPairingCode(): PairingInfo {
    // 清除旧的配对状态
    this.clearPairingState();

    const code = generatePairingCode();
    const expiresAt = Date.now() + PAIRING_CODE_TTL;

    this.currentPairing = {
      code,
      expiresAt,
      status: 'pending',
    };

    // 设置过期定时器
    this.expiryTimer = setTimeout(() => {
      this.handlePairingExpiry();
    }, PAIRING_CODE_TTL);

    this.emit('pairingCodeGenerated', this.currentPairing);
    return this.currentPairing;
  }

  /**
   * 验证配对码
   * @param code 配对码
   * @returns 是否有效
   */
  validatePairingCode(code: string): boolean {
    if (!this.currentPairing) {
      return false;
    }

    if (this.currentPairing.status !== 'pending') {
      return false;
    }

    if (Date.now() > this.currentPairing.expiresAt) {
      this.handlePairingExpiry();
      return false;
    }

    return this.currentPairing.code === code;
  }

  /**
   * 完成配对
   * @param clientId 客户端设备 ID
   * @param clientPublicKey 客户端公钥
   * @param clientName 客户端名称（可选）
   */
  async completePairing(
    clientId: string,
    clientPublicKey: string,
    clientName?: string
  ): Promise<void> {
    if (!this.currentPairing || this.currentPairing.status !== 'pending') {
      throw new Error('没有待处理的配对请求');
    }

    // 检查是否已配对
    const existingIndex = this.pairedClients.findIndex(
      (c) => c.clientId === clientId
    );

    const client: PairedClient = {
      clientId,
      publicKey: clientPublicKey,
      pairedAt: Date.now(),
    };

    if (clientName !== undefined) {
      client.name = clientName;
    }

    if (existingIndex >= 0) {
      // 更新现有配对
      this.pairedClients[existingIndex] = client;
    } else {
      // 添加新配对
      this.pairedClients.push(client);
    }

    // 更新配对状态
    this.currentPairing.status = 'completed';
    this.clearExpiryTimer();

    // 派生并缓存共享密钥
    await this.deriveAndCacheSharedKey(clientId, clientPublicKey);

    // 保存配对数据
    await this.savePairingData();

    this.emit('pairingSuccess', client);
  }

  /**
   * 获取共享密钥
   * @param clientId 客户端 ID
   * @returns 共享密钥（如果已配对）
   */
  async getSharedKey(clientId: string): Promise<CryptoKey | null> {
    // 尝试从缓存获取
    const cached = this.sharedKeyCache.get(clientId);
    if (cached) {
      return cached;
    }

    // 查找配对信息
    const client = this.pairedClients.find((c) => c.clientId === clientId);
    if (!client) {
      return null;
    }

    // 派生并缓存共享密钥
    return this.deriveAndCacheSharedKey(clientId, client.publicKey);
  }

  /**
   * 检查客户端是否已配对
   * @param clientId 客户端 ID
   */
  isPaired(clientId: string): boolean {
    return this.pairedClients.some((c) => c.clientId === clientId);
  }

  /**
   * 移除配对
   * @param clientId 客户端 ID
   */
  async removePairing(clientId: string): Promise<void> {
    const index = this.pairedClients.findIndex((c) => c.clientId === clientId);
    if (index >= 0) {
      this.pairedClients.splice(index, 1);
      this.sharedKeyCache.delete(clientId);
      await this.savePairingData();
    }
  }

  /**
   * 获取所有已配对的客户端
   */
  getPairedClients(): PairedClient[] {
    return [...this.pairedClients];
  }

  /**
   * 获取当前配对状态
   */
  get currentPairingInfo(): PairingInfo | null {
    return this.currentPairing;
  }

  /**
   * 获取设备 ID
   */
  get deviceId(): string {
    return this._deviceId;
  }

  /**
   * 获取公钥
   */
  get publicKey(): string {
    return this.keyPair?.publicKey ?? '';
  }

  // --------------------------------------------------------------------------
  // 私有方法
  // --------------------------------------------------------------------------

  /**
   * 生成设备 ID
   */
  private generateDeviceId(): string {
    const array = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(array)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * 确保配置目录存在
   */
  private async ensureConfigDir(): Promise<void> {
    try {
      await fs.mkdir(CONFIG_DIR, { recursive: true });
    } catch {
      // 目录可能已存在
    }
  }

  /**
   * 加载配对数据
   */
  private async loadPairingData(): Promise<PairingData | null> {
    try {
      const content = await fs.readFile(PAIRING_DATA_FILE, 'utf-8');
      return JSON.parse(content) as PairingData;
    } catch {
      return null;
    }
  }

  /**
   * 保存配对数据
   */
  private async savePairingData(): Promise<void> {
    if (!this.keyPair) {
      throw new Error('密钥对未初始化');
    }

    // 导出私钥为 JWK 格式
    const privateKeyJwk = await crypto.subtle.exportKey(
      'jwk',
      this.keyPair.privateKey
    );

    const data: PairingData = {
      deviceId: this._deviceId,
      publicKey: this.keyPair.publicKey,
      privateKeyJwk,
      pairedClients: this.pairedClients,
    };

    await fs.writeFile(PAIRING_DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 派生并缓存共享密钥
   */
  private async deriveAndCacheSharedKey(
    clientId: string,
    clientPublicKey: string
  ): Promise<CryptoKey> {
    if (!this.keyPair) {
      throw new Error('密钥对未初始化');
    }

    const sharedKey = await deriveSharedSecret(
      this.keyPair.privateKey,
      clientPublicKey
    );

    this.sharedKeyCache.set(clientId, sharedKey);
    return sharedKey;
  }

  /**
   * 处理配对码过期
   */
  private handlePairingExpiry(): void {
    if (this.currentPairing && this.currentPairing.status === 'pending') {
      this.currentPairing.status = 'expired';
      this.emit('pairingExpired');
    }
    this.clearExpiryTimer();
  }

  /**
   * 清除配对状态
   */
  private clearPairingState(): void {
    this.currentPairing = null;
    this.clearExpiryTimer();
  }

  /**
   * 清除过期定时器
   */
  private clearExpiryTimer(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }
}

// ============================================================================
// 类型增强
// ============================================================================

// 为 EventEmitter 添加类型支持
export declare interface PairingManager {
  on<K extends keyof PairingManagerEvents>(event: K, listener: PairingManagerEvents[K]): this;
  emit<K extends keyof PairingManagerEvents>(event: K, ...args: Parameters<PairingManagerEvents[K]>): boolean;
  off<K extends keyof PairingManagerEvents>(event: K, listener: PairingManagerEvents[K]): this;
  once<K extends keyof PairingManagerEvents>(event: K, listener: PairingManagerEvents[K]): this;
}
