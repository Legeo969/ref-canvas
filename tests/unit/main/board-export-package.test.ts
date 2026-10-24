import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dialogMock = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  showOpenDialog: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "C:\\RefCanvas\\Documents"), isPackaged: true },
  BrowserWindow: class {},
  dialog: dialogMock,
  ipcMain: {},
}));

import { registerBoardIpc } from "../../../src/main/ipc/board-ipc";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";

const boardId = "11111111-1111-4111-8111-111111111111";

function createHarness(options: {
  boardAssets: string[];
  assetPaths: Record<string, string | null>;
}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, (...args: unknown[]) => handler({}, ...args)),
    on: vi.fn(),
  } as unknown as SecureIpcRegistrar;

  const document = {
    schemaVersion: 2,
    canvas: {
      objects: options.boardAssets.map((assetId, index) => ({
        type: "image",
        left: index * 10,
        top: 0,
        src: `refasset://asset/${assetId}`,
        data: { objectId: `obj-${index}`, assetId },
      })),
    },
    viewport: { transform: [1, 0, 0, 1, 0, 0], zoom: 1 },
    guides: { x: [], y: [] },
  };

  registerBoardIpc(ipc, {
    copyProjectAsset: async (assetId, destination) => {
      const source = options.assetPaths[assetId];
      if (!source) return null;
      const assetDirectory = path.join(destination, "assets", assetId);
      await mkdir(assetDirectory, { recursive: true });
      const relativePath = path.join("assets", assetId, path.basename(source));
      await writeFile(path.join(destination, relativePath), await readFile(source));
      return { id: assetId, source, relativePath };
    },
    getBoardReferences: () => ({ resolveReferences: async () => [] }) as never,
    getDatabase: () => ({
      loadBoard: () => ({
        summary: { id: boardId, title: "Test board", createdAt: "", updatedAt: "", revision: 1 },
        document,
      }),
      getBoardAssetIds: () => options.boardAssets,
    }) as never,
    getMainWindow: () => null,
    notifyBoardFlushComplete: () => undefined,
    openBoardWindow: () => undefined,
    pngDataUrlToBuffer: () => Buffer.alloc(0),
    relinkBoardAsset: async () => ({}) as never,
    materializePath: async () => ({ asset: { id: "a" } }),
    windowForSender: () => ({}) as never,
    writeAccess: {
      authorizePickerSelection: async (requests: Array<{ path: string }>) =>
        requests.map((request) => request.path),
    } as never,
  });

  return { handlers, document };
}

describe("boards:export-package", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    dialogMock.showSaveDialog.mockReset();
    for (const directory of temporaryDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function tempDir(): Promise<string> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-export-"));
    temporaryDirectories.push(directory);
    return directory;
  }

  it("writes a self-contained package and skips missing assets", async () => {
    const root = await tempDir();
    const goodImage = path.join(root, "good.png");
    await writeFile(goodImage, Buffer.from("image-bytes"));
    const destination = path.join(root, "out.refcanvas");
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });

    const { handlers } = createHarness({
      boardAssets: ["asset-good", "asset-missing"],
      assetPaths: { "asset-good": goodImage, "asset-missing": null },
    });

    const result = (await handlers.get("boards:export-package")!(
      boardId,
      { embedAssets: true },
    )) as { path: string; skippedAssets: number };

    expect(result.skippedAssets).toBe(1);
    expect(result.path).toBe(destination);

    const written = JSON.parse(await readFile(destination, "utf8")) as {
      format: string;
      assets: Array<{ id: string }>;
      files: Array<{ relativePath: string; dataBase64: string }>;
    };
    expect(written.format).toBe("refcanvas-package");
    expect(written.assets).toHaveLength(1);
    expect(written.assets[0].id).toBe("asset-good");
    expect(written.files).toHaveLength(1);
    expect(Buffer.from(written.files[0].dataBase64, "base64").toString()).toBe("image-bytes");
  });

  it("returns null when the save dialog is cancelled", async () => {
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });

    const { handlers } = createHarness({ boardAssets: [], assetPaths: {} });

    const result = await handlers.get("boards:export-package")!(boardId, { embedAssets: true });
    expect(result).toBeNull();
  });

  it("surfaces a diagnosable error when the export throws", async () => {
    dialogMock.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: path.join(os.tmpdir(), "whatever.refcanvas"),
    });

    const { handlers } = createHarness({ boardAssets: [], assetPaths: {} });
    // 让 writeAccess 抛错模拟权限失败
    handlers.set("__unused", () => undefined);

    await expect(
      handlers.get("boards:export-package")!(boardId, { embedAssets: "not-a-boolean" }),
    ).rejects.toThrow(/EXPORT_PACKAGE_FAILED/);
  });
});
