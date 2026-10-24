// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadCleanBoardImageElement,
  resetCleanBoardImageCache,
} from "../../../../src/renderer/app/board-image-loader";

class FakeResponse {
  constructor(private readonly body: Blob) {}
  get ok(): boolean {
    return true;
  }
  async blob(): Promise<Blob> {
    return this.body;
  }
}

class NotOkResponse {
  get ok(): boolean {
    return false;
  }
  async blob(): Promise<Blob> {
    return new Blob(["unauthorized"]);
  }
}

describe("loadCleanBoardImageElement", () => {
  afterEach(() => {
    resetCleanBoardImageCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches with page referrer and returns a bitmap", async () => {
    const fetchMock = vi.fn(async () => new FakeResponse(new Blob(["x"])));
    vi.stubGlobal("fetch", fetchMock);
    const bitmap = { width: 4, height: 4 };
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));

    const element = await loadCleanBoardImageElement("refasset://thumbnail/1");

    expect(element).toBe(bitmap);
    expect(fetchMock).toHaveBeenCalledWith("refasset://thumbnail/1", {
      referrer: window.location.href,
    });
  });

  it("returns null when the protocol rejects the fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new NotOkResponse()));
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({}) as ImageBitmap));
    const element = await loadCleanBoardImageElement("refasset://thumbnail/2");
    expect(element).toBeNull();
  });

  it("returns null when createImageBitmap rejects the payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new FakeResponse(new Blob(["x"]))));
    vi.stubGlobal("createImageBitmap", vi.fn(async () => {
      throw new Error("decode failed");
    }));
    const element = await loadCleanBoardImageElement("refasset://thumbnail/3");
    expect(element).toBeNull();
  });

  it("returns null when the fetch itself fails (network/protocol error)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({}) as ImageBitmap));
    const element = await loadCleanBoardImageElement("refasset://thumbnail/4");
    expect(element).toBeNull();
  });
});
