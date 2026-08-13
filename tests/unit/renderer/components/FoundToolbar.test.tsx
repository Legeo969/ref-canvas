// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoundToolbar } from "../../../../src/renderer/components/FoundToolbar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("FoundToolbar variants", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];
  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
  });

  async function render(variant: Parameters<typeof FoundToolbar>[0]["variant"]) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<FoundToolbar variant={variant} />));
    return host;
  }

  it("renders image tools without a timeline or volume", async () => {
    const host = await render("image");
    expect(host.querySelector('[role="slider"]')).toBeNull();
    expect(host.querySelector('[aria-label="音量"]')).toBeNull();
    expect(host.querySelector('[aria-label="网格"]')).toBeNull();
  });

  it("renders video timeline, trim, volume and GIF export", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(
      <FoundToolbar variant="video" onGifExport={() => undefined} />,
    ));
    expect(host.querySelector('[role="slider"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="裁剪或分割"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="音量"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="导出 GIF"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="播放"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="上一帧"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="下一帧"]')).toBeTruthy();
  });

  it("routes playback and frame-step commands", async () => {
    const toggle = vi.fn();
    const step = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(
      <FoundToolbar variant="video" playing={false} onPlayingToggle={toggle} onStepFrames={step} />,
    ));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="播放"]')?.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="上一帧"]')?.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="下一帧"]')?.click());
    expect(toggle).toHaveBeenCalledOnce();
    expect(step.mock.calls).toEqual([[-1], [1]]);
  });

  it("uses sequence controls without volume", async () => {
    const seek = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(
      <FoundToolbar variant="sequence" seekPosition={0.5} onSeekChange={seek} />,
    ));
    expect(host.querySelector('[role="slider"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="音量"]')).toBeNull();
    expect(host.querySelector('[aria-label="导出 GIF"]')).toBeNull();
  });

  it("does not advertise audio controls for GIF files", async () => {
    const host = await render("gif");
    expect(host.querySelector('[aria-label="音量"]')).toBeNull();
  });

  it("does not render commands that have no implementation", async () => {
    const host = await render("image");
    for (const label of ["添加", "自动", "FPS", "网格", "画笔", "截图"]) {
      expect(host.querySelector(`[aria-label="${label}"]`)).toBeNull();
    }
  });

  it("supports keyboard seeking with an accessible timeline name", async () => {
    const seek = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(
      <FoundToolbar variant="video" seekPosition={0.5} onSeekChange={seek} />,
    ));
    const slider = host.querySelector<HTMLElement>('[role="slider"]')!;
    expect(slider.getAttribute("aria-label")).toBe("预览时间线");
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(seek.mock.calls).toEqual([[0.51], [0], [1]]);
  });

  it("routes LUT, color palette, multichannel and notes actions by capability", async () => {
    const onLut = vi.fn();
    const onPalette = vi.fn();
    const onChannels = vi.fn();
    const onNotes = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(
      <FoundToolbar
        variant="sequence"
        multichannel
        onLutToggle={onLut}
        onPaletteToggle={onPalette}
        onMultichannelToggle={onChannels}
        onNotesToggle={onNotes}
      />,
    ));
    for (const label of ["LUT", "色彩栏", "提取多通道", "资产备注"]) {
      await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click());
    }
    expect(onLut).toHaveBeenCalledOnce();
    expect(onPalette).toHaveBeenCalledOnce();
    expect(onChannels).toHaveBeenCalledOnce();
    expect(onNotes).toHaveBeenCalledOnce();
  });

  it("opens color tools as a separate contextual toolbar and only collapses the fixed palette", async () => {
    const onPalette = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(
      <FoundToolbar
        variant="image"
        colorSwatches={["#112233", "#445566"]}
        sampledColorSwatches={["#abcdef"]}
        paletteActive
        onPaletteToggle={onPalette}
        onSampleColor={() => undefined}
        onClearSampledColors={() => undefined}
        trailingActions={<button aria-label="全屏预览" />}
      />,
    ));

    const row = host.querySelector(".found-toolbar-row.secondary")!;
    const scroll = row.querySelector(".found-toolbar-scroll")!;
    const tail = row.querySelector(".found-toolbar-tail")!;
    const colorTools = host.querySelector(".found-color-context-toolbar")!;
    expect(scroll.querySelector('[aria-label="色彩栏"]')).toBeTruthy();
    expect(tail.querySelectorAll(".found-color-swatch")).toHaveLength(0);
    expect(colorTools.querySelectorAll(".found-color-swatch.fixed")).toHaveLength(2);
    expect(colorTools.querySelectorAll(".found-color-swatch.sampled")).toHaveLength(1);
    expect(colorTools.querySelector('[aria-label="吸取颜色"]')).toBeTruthy();
    expect(colorTools.querySelector('[aria-label="清除吸取颜色"]')).toBeTruthy();
    expect(colorTools.querySelector('[aria-label="收起固定颜色板"]')).toBeTruthy();
    expect(tail.querySelector('[aria-label="全屏预览"]')).toBeTruthy();

    await act(async () => colorTools.querySelector<HTMLButtonElement>('[aria-label="收起固定颜色板"]')?.click());
    expect(colorTools.querySelectorAll(".found-color-swatch.fixed")).toHaveLength(0);
    expect(colorTools.querySelectorAll(".found-color-swatch.sampled")).toHaveLength(1);
    expect(colorTools.querySelector('[aria-label="展开固定颜色板"]')).toBeTruthy();
  });

  it("closes the entire color contextual toolbar when its main trigger is clicked again", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <FoundToolbar
          variant="image"
          paletteActive={open}
          colorSwatches={["#112233", "#445566", "#778899", "#aabbcc", "#ddeeff"]}
          onPaletteToggle={() => setOpen((value) => !value)}
        />
      );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<Harness />));
    expect(host.querySelector(".found-color-context-toolbar")).toBeTruthy();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="色彩栏"]')?.click());
    expect(host.querySelector(".found-color-context-toolbar")).toBeNull();
  });

  it("routes FPS and shows active contextual tools as pressed", async () => {
    const onFps = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(
      <FoundToolbar
        variant="video"
        fpsActive
        notesActive
        lutActive
        gifActive
        onFpsToggle={onFps}
        onNotesToggle={() => undefined}
        onLutToggle={() => undefined}
        onGifExport={() => undefined}
      />,
    ));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="FPS"]')?.click());
    expect(onFps).toHaveBeenCalledOnce();
    for (const label of ["FPS", "资产备注", "LUT", "导出 GIF"]) {
      expect(host.querySelector(`[aria-label="${label}"]`)?.getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("anchors the LUT menu to the toolbar button instead of the content tray", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(
      <FoundToolbar
        variant="image"
        lutActive
        onLutToggle={() => undefined}
        lutMenu={<div data-testid="lut-menu-content">LUT options</div>}
      />,
    ));
    const menu = document.body.querySelector(".found-lut-anchor-menu");
    expect(menu?.querySelector('[data-testid="lut-menu-content"]')).toBeTruthy();
    expect(host.querySelector(".found-toolbar-scroll .found-lut-anchor-menu")).toBeNull();
    expect(menu?.getAttribute("data-placement")).toBe("top-start");
  });
});
