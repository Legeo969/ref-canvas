// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scratchRoots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => scratchRoots[0] ?? "C:\\RefCanvas"),
    getVersion: vi.fn(() => "0.0.0"),
    isPackaged: false,
    quit: vi.fn(),
  },
  clipboard: {},
  desktopCapturer: {},
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  globalShortcut: {},
  nativeImage: {},
  screen: {},
  shell: {},
}));

import { dialog } from "electron";
import { registerSystemIpc } from "../../../src/main/ipc/system-ipc";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";

/**
 * 「用本地图片设置缩略图」的 IPC 契约：
 * - 选中的图片必须被规范化成 PNG 再落盘（协议层按 image/png 回包）；
 * - 超过 1024px 的源要缩到 1024 以内，避免把 8K 图塞进缩略图缓存；
 * - 用户取消选择返回 null，不写库。
 */
describe("system:set-thumbnail-from-file", () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), "refcanvas-thumb-"));
    scratchRoots.length = 0;
    scratchRoots.push(scratch);
  });

  afterEach(async () => {
    scratchRoots.length = 0;
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  });

  interface Handlers {
    get(channel: string): ((...args: unknown[]) => unknown) | undefined;
  }

  function setup(pickedPath: string | null, setCustomThumbnail = vi.fn(() => ({ id: "asset" }))) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      on: vi.fn(),
    } as unknown as SecureIpcRegistrar;

    const authorizePickerSelection = vi.fn(async (requests: Array<{ path: string }>) =>
      requests.map((request) => request.path),
    );
    const getDatabase = vi.fn(() => ({}));

    registerSystemIpc(ipc, {
      state: {},
      getDatabase,
      getLibrary: () => ({ setCustomThumbnail }),
      getLibraryManager: () => ({}),
      getMainWindow: () => null,
      windowForSender: () => ({ id: 1 }),
      writeAccess: { authorizePickerSelection } as never,
    } as unknown as Parameters<typeof registerSystemIpc>[1]);

    vi.mocked(dialog.showOpenDialog).mockResolvedValue(
      pickedPath
        ? { canceled: false, filePaths: [pickedPath] }
        : { canceled: true, filePaths: [] },
    );

    return { handlers, setCustomThumbnail, authorizePickerSelection } as unknown as {
      handlers: Handlers;
      setCustomThumbnail: ReturnType<typeof vi.fn>;
      authorizePickerSelection: ReturnType<typeof vi.fn>;
    };
  }

  it("normalizes the chosen image to PNG inside userData", async () => {
    const source = path.join(scratch, "shot.jpg");
    await sharp({
      create: { width: 320, height: 200, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .jpeg()
      .toFile(source);

    const { handlers, setCustomThumbnail } = setup(source);
    await handlers.get("system:set-thumbnail-from-file")!({}, "11111111-1111-4111-8111-111111111111");

    expect(setCustomThumbnail).toHaveBeenCalledOnce();
    const [assetId, writtenPath] = setCustomThumbnail.mock.calls[0] as unknown as [string, string];
    expect(assetId).toBe("11111111-1111-4111-8111-111111111111");
    const bytes = await readFile(writtenPath);
    // PNG 魔数。
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(320);
  });

  it("downscales oversized source images to at most 1024px", async () => {
    const source = path.join(scratch, "huge.png");
    await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: { r: 20, g: 120, b: 200 } },
    })
      .png()
      .toFile(source);

    const { handlers, setCustomThumbnail } = setup(source);
    await handlers.get("system:set-thumbnail-from-file")!({}, "22222222-2222-4222-8222-222222222222");

    const [, writtenPath] = setCustomThumbnail.mock.calls[0] as unknown as [string, string];
    const metadata = await sharp(await readFile(writtenPath)).metadata();
    expect(metadata.width).toBe(1024);
    expect(metadata.height).toBe(683); // 保持 3:2 比例
  });

  it("returns null and writes nothing when the picker is cancelled", async () => {
    const { handlers, setCustomThumbnail } = setup(null);
    const result = await handlers.get("system:set-thumbnail-from-file")!(
      {},
      "33333333-3333-4333-8333-333333333333",
    );
    expect(result).toBeNull();
    expect(setCustomThumbnail).not.toHaveBeenCalled();
  });
});
