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

  it("keeps arbitrary script IPC fail-closed and avoids PowerShell policy bypass", async () => {
    const ipcText = await source("src/main/ipc/resources-ipc.ts");
    const scripts = ipcText.slice(
      ipcText.indexOf("const scriptExecutionDisabled"),
      ipcText.indexOf("// --- color:get-status"),
    );
    expect(scripts).toContain('handle("scripts:register", scriptExecutionDisabled)');
    expect(scripts).toContain('handle("scripts:run", scriptExecutionDisabled)');
    expect(scripts).toContain("SCRIPT_EXECUTION_DISABLED_UNSANDBOXED");

    const serviceText = await source("src/main/services/scripts-service.ts");
    expect(serviceText).not.toContain('"ExecutionPolicy", "Bypass"');
  });
});
