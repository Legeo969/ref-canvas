// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectoryCard } from "../../../../src/renderer/components/DirectoryAssetPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("DirectoryCard progressive preview", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];
  afterEach(async () => {
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    document.body.replaceChildren();
  });

  it("shows a quiet type placeholder while thumbnail generation is pending", async () => {
    Object.assign(window, { refCanvas: { filesystem: {
      previewToken: vi.fn(async () => "obj-token"),
    } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<DirectoryCard
        entry={{ path: "D:\\refs\\mesh.obj", name: "mesh.obj", extension: "obj", isDirectory: false, size: 10 }}
        selected={false} query="" onEnter={vi.fn()} onSelect={vi.fn()} onPreview={vi.fn()} onDragOut={vi.fn()}
        folderClickMode="double" priority="visible"
      />);
      await Promise.resolve();
    });
    expect(host.querySelector(".asset-placeholder")?.textContent).toContain("OBJ");
    expect(host.querySelector(".preview-cache-loading")).toBeNull();
    expect(host.querySelector(".asset-preview img")?.classList.contains("preview-image-pending")).toBe(true);
  });
});
