import { describe, expect, it, vi } from "vitest";
import { registerFilesystemIpc } from "../../../src/main/ipc/filesystem-ipc";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";
import type {
  WriteOperation,
  WritePathRequest,
} from "../../../src/main/platform/write-access-controller";

describe("filesystem mutation authorization matrix", () => {
  it("authorizes the required source/target roles before each mutation", async () => {
    const source = "C:\\source\\asset.exr";
    const target = "D:\\deliveries";
    const pathOnTargetDrive = "D:\\deliveries\\asset.exr";
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    } as unknown as SecureIpcRegistrar;
    const authorize = vi.fn(async (
      _window: Electron.BrowserWindow,
      _operation: WriteOperation,
      requests: WritePathRequest[],
    ) => requests.map((request) => request.path));
    const fileOperations = {
      assertPath: vi.fn(async (filename: string) => filename),
      createFolder: vi.fn(),
      copy: vi.fn(),
      move: vi.fn(),
    };
    const archive = vi.fn();
    const startBatch = vi.fn();
    const resolveSearchSelection = vi.fn()
      .mockResolvedValueOnce({ paths: [source], nextOffset: 1, total: 2 })
      .mockResolvedValueOnce({ paths: [pathOnTargetDrive], nextOffset: null, total: 2 });
    registerFilesystemIpc(ipc, {
      getDirectoryBatches: () => ({ start: startBatch, get: vi.fn(), cancel: vi.fn() }),
      getDirectoryService: () => ({
        getSearch: vi.fn(),
        resolveSearchSelection,
        listDirectory: vi.fn(),
      }),
      getFileOperations: () => fileOperations,
      getLibrary: () => ({ renameSourceFile: vi.fn() }),
      getMountRoots: () => [],
      previewTokens: {},
      trashDirectoryPath: vi.fn(),
      windowForSender: () => ({}) as Electron.BrowserWindow,
      writeAccess: { authorize },
      getArchiveService: () => ({ archive, cancel: vi.fn() }),
    } as unknown as Parameters<typeof registerFilesystemIpc>[1]);
    const event = {};

    for (const invalid of [
      "relative.txt",
      "C:drive-relative.txt",
      "https://evil.example/file",
      "\\\\server\\share\\file",
      "\\\\?\\C:\\file",
      "C:\\file.txt:ads",
    ]) {
      expect(() => handlers.get("filesystem:list-directory")!(invalid, undefined))
        .toThrow("INVALID_LOCAL_PATH");
    }

    await handlers.get("filesystem:copy")!(event, [source], target, undefined);
    expect(authorize).toHaveBeenLastCalledWith(expect.anything(), "copy", [
      { path: target, mode: "destination" },
    ]);

    await handlers.get("filesystem:move")!(event, [source], target, undefined);
    expect(authorize).toHaveBeenLastCalledWith(expect.anything(), "move", [
      { path: source, mode: "existing" },
      { path: target, mode: "destination" },
    ]);

    await handlers.get("filesystem:trash")!(event, [source], undefined);
    expect(authorize).toHaveBeenLastCalledWith(expect.anything(), "trash", [
      { path: source, mode: "existing" },
    ]);

    await handlers.get("filesystem:rename")!(event, source, "renamed.exr", undefined);
    expect(authorize).toHaveBeenLastCalledWith(expect.anything(), "rename", [
      { path: source, mode: "existing" },
      { path: "C:\\source\\renamed.exr", mode: "destination" },
    ]);

    await handlers.get("filesystem:create-folder")!(event, target, "new", undefined);
    expect(authorize).toHaveBeenLastCalledWith(expect.anything(), "create-folder", [
      { path: "D:\\deliveries\\new", mode: "destination" },
    ]);

    await handlers.get("filesystem:archive")!(event, {
      sources: [source],
      targetDirectory: target,
      baseName: "delivery",
      jobId: "job-1",
    });
    expect(authorize).toHaveBeenLastCalledWith(expect.anything(), "archive", [
      { path: "D:\\deliveries\\delivery.zip", mode: "destination" },
    ]);
    expect(archive).toHaveBeenCalled();

    authorize.mockClear();
    await handlers.get("filesystem:start-batch")!(event, {
      mode: "search",
      searchId: "search-1",
      revision: "revision-1",
      excludedPaths: [],
    }, { type: "trash" });
    expect(resolveSearchSelection).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenNthCalledWith(1, expect.anything(), "trash", [
      { path: source, mode: "existing" },
      { path: pathOnTargetDrive, mode: "existing" },
    ]);
    expect(authorize).toHaveBeenNthCalledWith(2, expect.anything(), "trash", [
      { path: source, mode: "existing" },
      { path: pathOnTargetDrive, mode: "existing" },
    ]);
    expect(startBatch.mock.invocationCallOrder[0]).toBeGreaterThan(
      authorize.mock.invocationCallOrder.at(-1)!,
    );
    expect(startBatch).toHaveBeenCalledWith({
      mode: "explicit",
      paths: [source, pathOnTargetDrive],
    }, { type: "trash" });

    startBatch.mockClear();
    authorize.mockReset();
    authorize
      .mockImplementationOnce(async (_window, _operation, requests) =>
        requests.map((request) => request.path))
      .mockRejectedValueOnce(new Error("WRITE_ACCESS_DENIED"));
    await expect(handlers.get("filesystem:start-batch")!(event, {
      mode: "explicit",
      paths: [source, pathOnTargetDrive],
    }, { type: "trash" })).rejects.toThrow("WRITE_ACCESS_DENIED");
    expect(startBatch).not.toHaveBeenCalled();
  });
});
