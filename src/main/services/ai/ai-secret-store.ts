/**
 * AI 密钥存储（§9.6）。
 *
 * Bearer token 由 Electron `safeStorage` 加密后保存；Renderer 只能读取
 * "已配置" 状态，永不接触明文。SQLite、日志与错误消息均不得出现明文。
 *
 * 测试环境（非 Electron）使用注入的 fallback 实现（内存或文件）。
 */
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SecretCipher {
  encrypt(plaintext: string): Buffer;
  decrypt(blob: Buffer): string;
  isAvailable(): boolean;
}

/** 非 Electron 测试 fallback：Base64 + 会话随机盐（非加密，仅测试）。 */
export class InsecureTestCipher implements SecretCipher {
  private readonly salt = randomUUID();

  isAvailable(): boolean {
    return true;
  }

  encrypt(plaintext: string): Buffer {
    return Buffer.from(`${this.salt}:${plaintext}`, "utf8");
  }

  decrypt(blob: Buffer): string {
    const text = blob.toString("utf8");
    const separator = text.indexOf(":");
    if (separator < 0) throw new Error("SECRET_DECRYPT_FAILED");
    return text.slice(separator + 1);
  }
}

export interface SecretStoreOptions {
  /** 密钥文件路径（加密 blob）。 */
  filePath: string;
  /** 加密实现；默认使用 Electron safeStorage（不可用时抛错）。 */
  cipher?: SecretCipher;
}

export class AiSecretStore {
  private readonly cipher: SecretCipher;

  constructor(private readonly options: SecretStoreOptions) {
    this.cipher = options.cipher ?? this.electronCipher();
  }

  private electronCipher(): SecretCipher {
    // 惰性加载 electron：单元测试（node 环境）不加载。
    // 构建/运行时由 Electron 提供 safeStorage；不可用（如 Linux 无 keyring）
    // 时保存/读取抛 SECRET_STORAGE_UNAVAILABLE。
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require("electron") as {
        safeStorage?: {
          encryptString(text: string): Buffer;
          decryptString(blob: Buffer): string;
          isEncryptionAvailable(): boolean;
        };
      };
      const safeStorage = electron.safeStorage;
      if (!safeStorage) throw new Error("SECRET_STORAGE_UNAVAILABLE");
      return {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (plaintext: string) => safeStorage.encryptString(plaintext),
        decrypt: (blob: Buffer) => safeStorage.decryptString(blob),
      };
    } catch {
      throw new Error("SECRET_STORAGE_UNAVAILABLE");
    }
  }

  isConfigured(): boolean {
    // 同步探测文件是否存在且非空（read() 是异步的，不能在此 await）。
    try {
      if (!existsSync(this.options.filePath)) return false;
      const info = statSync(this.options.filePath);
      return info.size > 0;
    } catch {
      return false;
    }
  }

  async save(secret: string): Promise<void> {
    if (!this.cipher.isAvailable()) throw new Error("SECRET_STORAGE_UNAVAILABLE");
    if (typeof secret !== "string" || secret.length === 0 || secret.length > 4096) {
      throw new Error("SECRET_INVALID");
    }
    const blob = this.cipher.encrypt(secret);
    await writeFile(this.options.filePath, blob, { mode: 0o600 });
  }

  async clear(): Promise<void> {
    await writeFile(this.options.filePath, Buffer.alloc(0));
  }

  async read(): Promise<string> {
    const blob = await readFile(this.options.filePath).catch(() => {
      throw new Error("SECRET_NOT_CONFIGURED");
    });
    if (blob.length === 0) throw new Error("SECRET_NOT_CONFIGURED");
    return this.cipher.decrypt(blob);
  }

  /** 返回脱敏状态，绝不含明文（供 Settings IPC 使用）。 */
  async status(): Promise<{ configured: boolean; source: "safe-storage" | "test" }> {
    const configured = await this.read().then(() => true).catch(() => false);
    return {
      configured,
      source: this.cipher instanceof InsecureTestCipher ? "test" : "safe-storage",
    };
  }

  static filePathFor(userData: string): string {
    return path.join(userData, "ai-provider-secret.bin");
  }
}
