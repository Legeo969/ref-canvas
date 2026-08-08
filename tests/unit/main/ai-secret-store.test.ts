import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AiSecretStore, InsecureTestCipher } from "../../../src/main/services/ai/ai-secret-store";

const temporaryDirectories: string[] = [];

async function removeDirectory(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(removeDirectory));
});

async function openStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-secret-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "secret.bin");
  const store = new AiSecretStore({ filePath, cipher: new InsecureTestCipher() });
  return { directory, filePath, store };
}

describe("ai secret store (FND-010 §9.6)", () => {
  it("saves, reads and clears the encrypted token", async () => {
    const { store, filePath } = await openStore();
    await store.save("Bearer sk-test-123");
    expect(await store.read()).toBe("Bearer sk-test-123");
    // 磁盘上的 blob 不是裸明文（测试 cipher 加了会话盐前缀；生产用 safeStorage
    // 真加密，此处验证 at-rest 格式不含原始令牌）。
    const blob = await readFile(filePath);
    expect(blob.toString("utf8")).not.toBe("Bearer sk-test-123");
    await store.clear();
    await expect(store.read()).rejects.toThrow("SECRET_NOT_CONFIGURED");
  });

  it("rejects invalid secret values", async () => {
    const { store } = await openStore();
    await expect(store.save("")).rejects.toThrow("SECRET_INVALID");
    await expect(store.save("x".repeat(5000))).rejects.toThrow("SECRET_INVALID");
  });

  it("status only exposes configured flag, never the token", async () => {
    const { store } = await openStore();
    expect((await store.status()).configured).toBe(false);
    await store.save("Bearer secret-abc");
    const status = await store.status();
    expect(status.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain("secret-abc");
  });

  it("unconfigured store reports not configured", async () => {
    const { directory } = await openStore();
    const store = new AiSecretStore({
      filePath: path.join(directory, "missing.bin"),
      cipher: new InsecureTestCipher(),
    });
    expect(store.isConfigured()).toBe(false);
    await expect(store.read()).rejects.toThrow("SECRET_NOT_CONFIGURED");
  });
});
