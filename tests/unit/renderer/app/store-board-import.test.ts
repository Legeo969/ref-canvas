// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssetRecord,
  BoardDocumentV3,
  BoardSummary,
  RefCanvasApi,
} from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { useAppStore } from "../../../../src/renderer/app/store";

setLanguage("zh-CN"); // 默认白板标题已迁移到 i18n key；断言基于简体中文 catalog。

const board: BoardSummary = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "参考板 01",
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
  revision: 1,
};

const document: BoardDocumentV3 = {
  schemaVersion: 3,
  canvas: { objects: [] },
  viewport: { transform: [1, 0, 0, 1, 0, 0], zoom: 1 },
  guides: { x: [], y: [] },
  appearance: { backgroundColor: "#202426", gridVisible: true, gridSize: 24 },
  windowMode: "normal",
  canvasMode: { locked: false, grayscale: false, gridStyle: "line" },
  sampling: "bilinear",
  exportSettings: { format: "png", embedAssets: false },
};

function asset(id: string, path: string): AssetRecord {
  return {
    id,
    title: path.split("\\").at(-1) ?? path,
    kind: "image",
    path,
    extension: "png",
    size: 1,
    mtimeMs: 1,
    fingerprint: `fingerprint-${id}`,
    contentHash: null,
    lifecycle: "active",
    deletedAt: null,
    trashPath: null,
    favorite: false,
    rating: 0,
    colorLabel: "none",
    linkState: "online",
    notes: "",
    width: 1,
    height: 1,
    duration: null,
    metadataStatus: "ready",
    metadataError: null,
    metadataUpdatedAt: null,
    bpm: null,
    customFields: {},
    customThumbnailPath: null,
    tags: [],
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    previewUrl: `refasset://asset/${id}`,
    thumbnailUrl: `refasset://thumbnail/${id}`,
  };
}

beforeEach(() => {
  useAppStore.setState({
    assets: [],
    boards: [board],
    activeBoard: board,
    boardDocument: document,
    pendingBoardAssetIds: [],
    workspaceMode: "directory",
  });
});

describe("directory files to reference board", () => {
  it("materializes unique paths and queues their asset ids", async () => {
    const first = asset("11111111-1111-4111-8111-111111111111", "D:\\refs\\a.png");
    const second = asset("33333333-3333-4333-8333-333333333333", "D:\\refs\\b.png");
    const materialize = vi.fn(async (path: string) => ({
      asset: path.endsWith("a.png") ? first : second,
      created: true,
      copied: false,
      verified: false,
    }));
    Object.assign(window, {
      refCanvas: { filesystem: { materialize } } as unknown as RefCanvasApi,
    });

    const added = await useAppStore
      .getState()
      .addDirectoryEntriesToBoard([first.path, second.path, first.path]);

    const state = useAppStore.getState();
    expect(materialize).toHaveBeenCalledTimes(2);
    // 返回新增资产：浏览器捕获据其回写来源元数据（App.importBrowserCapture）。
    expect(added.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(state.assets.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(state.pendingBoardAssetIds).toEqual([first.id, second.id]);
    expect(state.workspaceMode).toBe("board");
  });

  it("creates a default board when none exists", async () => {
    const first = asset("11111111-1111-4111-8111-111111111111", "D:\\refs\\a.png");
    const create = vi.fn(async () => board);
    const load = vi.fn(async () => ({ summary: board, document }));
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          materialize: vi.fn(async () => ({
            asset: first,
            created: true,
            copied: false,
            verified: false,
          })),
        },
        boards: { create, load },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({ boards: [], activeBoard: null, boardDocument: null });

    await useAppStore.getState().addDirectoryEntriesToBoard([first.path]);

    expect(create).toHaveBeenCalledWith("参考板 01");
    expect(load).toHaveBeenCalledWith(board.id);
    expect(useAppStore.getState().activeBoard).toEqual(board);
    expect(useAppStore.getState().pendingBoardAssetIds).toEqual([first.id]);
  });
});
