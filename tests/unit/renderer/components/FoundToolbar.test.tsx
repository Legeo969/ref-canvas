// @vitest-environment jsdom

import { act } from "react";
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
    expect(host.querySelector('[aria-label="网格"]')).toBeTruthy();
  });

  it("renders video timeline, trim, volume and GIF export", async () => {
    const host = await render("video");
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
    expect(host.querySelector('[aria-label="导出 GIF"]')).toBeTruthy();
  });

  it("does not advertise audio controls for GIF files", async () => {
    const host = await render("gif");
    expect(host.querySelector('[aria-label="音量"]')).toBeNull();
  });

  it("disables commands that have no implementation", async () => {
    const host = await render("image");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="添加"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="自动"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="网格"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="画笔"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="截图"]')?.disabled).toBe(true);
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

  it("marks unimplemented LUT and C commands as disabled placeholders", async () => {
    const host = await render("gif");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="颜色模式（尚不可用）"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="LUT（尚不可用）"]')?.disabled).toBe(true);
  });
});
