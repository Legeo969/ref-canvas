import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

async function source(relative: string): Promise<string> {
  return readFile(path.join(root, relative), "utf8");
}

describe("external mutation authorization inventory", () => {
  it("keeps every renderer-controlled external mutation event-aware and grant-gated", async () => {
    const inventories: Array<[string, string[]]> = [
      ["src/main/ipc/action-ipc.ts", [
        "actions:start", "actions:retry", "actions:resolve-conflict",
      ]],
      ["src/main/ipc/collections-ipc.ts", ["collections:export"]],
      ["src/main/ipc/library-management-ipc.ts", ["libraries:managed-migrate"]],
      ["src/main/ipc/resources-ipc.ts", [
        "media:exportGif", "media:exportFrames", "media:exportDisplayChannel",
        "sequences:exportMp4", "sequences:exportGif", "media:downscale",
      ]],
      ["src/main/ipc/ai-ipc.ts", ["ai:start", "ai:retry"]],
      ["src/main/ipc/library-ipc.ts", [
        "library:trash", "library:restore", "library:purge", "library:merge-duplicates",
      ]],
    ];
    for (const [filename, channels] of inventories) {
      const text = await source(filename);
      for (const channel of channels) {
        const marker = `handleWithEvent("${channel}"`;
        const start = text.indexOf(marker);
        expect(start).toBeGreaterThanOrEqual(0);
        const next = text.indexOf("ipc.handle", start + marker.length);
        const handler = text.slice(start, next < 0 ? text.length : next);
        expect(handler).toContain("authorize");
      }
    }
  });

  it("grant-gates the global clipboard capture shortcut", async () => {
    const text = await source("src/main/index.ts");
    const shortcut = text.slice(
      text.indexOf('"CommandOrControl+Shift+C"'),
      text.indexOf('"CommandOrControl+Shift+R"'),
    );
    expect(shortcut).toContain("writeAccess.authorize");
    expect(shortcut).toContain("canonicalDirectory");
  });

  it("keeps script IPC grant-gated with bounded registration and no PowerShell policy bypass", async () => {
    const ipcText = await source("src/main/ipc/resources-ipc.ts");
    const scripts = ipcText.slice(
      ipcText.indexOf('ipc.handle("scripts:list"'),
      ipcText.indexOf("// --- color:get-status"),
    );
    // B 方案信任链：运行前必须经过目录范围校验；注册输入必须有界。
    expect(scripts).toContain('handleWithEvent("scripts:run"');
    expect(scripts).toContain("writeAccess.authorize");
    expect(scripts).toContain('"execute"');
    expect(scripts).toContain(".max(4096)");
    expect(scripts).toContain(".max(3_600_000)");

    const serviceText = await source("src/main/services/scripts-service.ts");
    // 信任锚点：内容被篡改后拒绝运行。
    expect(serviceText).toContain("SCRIPT_HASH_CHANGED");
    // PowerShell 以 -NoProfile -File 调用且不经 shell，杜绝策略旁路。
    expect(serviceText).toContain('"-NoProfile", "-File"');
    expect(serviceText).toContain("shell: false");
    expect(serviceText).not.toContain('"ExecutionPolicy", "Bypass"');
  });
});
