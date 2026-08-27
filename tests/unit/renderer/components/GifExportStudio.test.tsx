// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefCanvasApi } from "../../../../src/shared/contracts";
import { GifExportStudio } from "../../../../src/renderer/components/GifExportStudio";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("GifExportStudio embedded range mode", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];
  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("uses the shared timeline range without rendering duplicate clip controls", async () => {
    const exportGif = vi.fn(async (_request: unknown) => ({ outputPath: "D:\\out\\clip.gif", width: 640, height: 360, durationSeconds: 4, sizeBytes: 10 }));
    Object.assign(window, { refCanvas: {
      media: { probe: vi.fn(async () => ({ duration: 10, width: 1920, height: 1080, extra: {} })), exportGif, cancel: vi.fn() },
      system: { pickDirectory: vi.fn(), pickFile: vi.fn(async () => []) },
      filesystem: { reveal: vi.fn() },
      library: { pathsForFiles: vi.fn(() => []) },
    } as unknown as RefCanvasApi });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<GifExportStudio initialPaths={["D:\\clip.mp4"]} initialRange={{ start: 0.2, end: 0.6 }} variant="panel" onClose={() => undefined} />);
      await Promise.resolve(); await Promise.resolve();
    });
    expect(host.querySelector(".gif-clip-list")).toBeNull();
    expect(host.querySelector(".gif-clip-range")).toBeNull();
    expect(host.querySelector(".gif-export-studio")?.getAttribute("draggable")).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(".gif-export-actions .primary-button")?.click());
    expect((exportGif.mock.calls[0]?.[0] as { clips: unknown[] }).clips).toEqual([{ inputPath: "D:\\clip.mp4", startMs: 2000, endMs: 6000 }]);
  });

  it("uses the same complete options panel for a selected image-sequence range", async () => {
    const exportGif = vi.fn(async (_request: unknown) => ({ outputPath: "D:\\out\\shot.gif", width: 640, height: 360, durationSeconds: 0.12, sizeBytes: 10 }));
    Object.assign(window, { refCanvas: {
      media: { probe: vi.fn(), exportGif: vi.fn(), cancel: vi.fn() },
      sequences: { exportGif },
      system: { pickDirectory: vi.fn(), pickFile: vi.fn(async () => []) },
      filesystem: { reveal: vi.fn() },
      library: { pathsForFiles: vi.fn(() => []) },
    } as unknown as RefCanvasApi });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const files = Array.from({ length: 5 }, (_, index) => `D:\\shot.${String(index + 1).padStart(4, "0")}.png`);
    await act(async () => {
      root.render(<GifExportStudio
        initialPaths={[]}
        sequence={{ files, fps: 25, baseName: "shot", directory: "D:\\out", range: { start: 0.25, end: 0.75 } }}
        variant="panel"
        onClose={() => undefined}
      />);
    });

    expect(host.querySelector(".gif-clip-list")).toBeNull();
    expect(host.querySelectorAll(".gif-export-options .select-menu-trigger")).toHaveLength(4);
    expect(host.querySelector<HTMLInputElement>('.gif-export-options input')?.value).toBe("shot");
    expect(host.querySelector('.gif-export-options .select-menu-trigger')?.textContent).toContain("25 FPS");
    await act(async () => host.querySelector<HTMLButtonElement>(".gif-export-actions .primary-button")?.click());
    expect(exportGif).toHaveBeenCalledWith(expect.objectContaining({
      files: files.slice(1, 4),
      fps: 25,
      maxWidth: 640,
      colors: 128,
      dither: "sierra2_4a",
      outputDirectory: "D:\\out",
      baseName: "shot",
    }));
  });
});
