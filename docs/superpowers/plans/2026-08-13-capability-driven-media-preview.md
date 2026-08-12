# Capability-driven Media Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a non-cropping, non-overlapping, theme-consistent preview workspace with working format-aware controls, notes, EXR/video workflows, GIF range export, and progressive model/DCC thumbnails.

**Architecture:** Extend the existing `PreviewTransport` into a capability-driven preview session instead of duplicating renderer state in `FoundPreviewPanel`. Keep expensive decoding and thumbnail generation behind the existing main-process provider/preview-cache boundary, while renderer components register snapshots and actions with the shared bottom workspace.

**Tech Stack:** Electron 43, React 19, TypeScript 5.9, Vitest/jsdom, Three.js, FFmpeg, OpenImageIO/exrs, SQLite, CSS design tokens.

---

### Task 1: Shared preview capabilities and stable layout

**Files:**
- Modify: `src/renderer/components/PreviewTransport.tsx`
- Modify: `src/renderer/components/found-preview-model.ts`
- Modify: `src/renderer/components/FoundPreviewPanel.tsx`
- Modify: `src/renderer/components/FoundToolbar.tsx`
- Modify: `src/renderer/styles/found-preview.css`
- Modify: `src/renderer/styles/ai.css`
- Test: `tests/unit/renderer/components/PreviewTransport.test.tsx`
- Test: `tests/unit/renderer/components/FoundPreviewPanel.test.tsx`
- Test: `tests/unit/renderer/components/FoundToolbar.test.tsx`
- Test: `tests/unit/renderer/components/PreviewSessionStyles.test.ts`

- [ ] **Step 1: Write failing tests for reset-on-asset-change, capability visibility, distinct focus/fullscreen chrome, neutral theme tokens, and one unobstructed `contain` viewport.**

```ts
expect(toolbar.querySelector('[aria-label="播放"]')).toBeEnabled();
expect(toolbar.querySelector('[aria-label="提取多通道"]')).toBeNull();
expect(panel.querySelector('.found-preview-viewport')).toHaveAttribute('data-fit', 'contain');
expect(css).not.toMatch(/\.ai-panel[^}]*#[0-9a-f]{6}/i);
```

- [ ] **Step 2: Run the focused tests and verify they fail for missing capabilities or current shared focus/fullscreen selectors.**

Run: `pnpm vitest run tests/unit/renderer/components/PreviewTransport.test.tsx tests/unit/renderer/components/FoundPreviewPanel.test.tsx tests/unit/renderer/components/FoundToolbar.test.tsx tests/unit/renderer/components/PreviewSessionStyles.test.ts`

- [ ] **Step 3: Add typed capability/action groups and render the shared filename, viewport, transport, and tool workspace in the confirmed vertical order.**

```ts
export interface PreviewCapabilities {
  playback: boolean; frameStep: boolean; volume: boolean; gifExport: boolean;
  multichannel: boolean; lut: boolean; palette: boolean; notes: boolean;
}
```

- [ ] **Step 4: Replace hard-coded AI/preview surface colors with `--surface-*`, `--text-*`, `--accent`, and `--border-*`; keep media at `object-fit: contain`.**

- [ ] **Step 5: Run the focused suite until green and commit.**

### Task 2: General and time/frame-linked asset notes

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/ipc/media-notes-ipc.ts`
- Modify: `src/main/persistence/database.ts`
- Create: `src/renderer/components/AssetNotesPanel.tsx`
- Modify: `src/renderer/components/FoundPreviewPanel.tsx`
- Test: `tests/unit/main/database.test.ts`
- Test: `tests/unit/renderer/components/AssetNotesPanel.test.tsx`

- [ ] **Step 1: Write failing persistence and component tests for general notes (`positionKind: general`) and playable notes (`time` or `frame`), including edit/delete and seek-on-click.**

```ts
await api.create(assetId, { positionKind: 'frame', position: 120, text: 'Fix edge' });
expect(onSeekFrame).toHaveBeenCalledWith(120);
```

- [ ] **Step 2: Run tests and verify the old required `timeMs` contract fails the general/frame cases.**

- [ ] **Step 3: Add a backward-compatible database migration and IPC schemas, then build `AssetNotesPanel` inside the bottom workspace.**

- [ ] **Step 4: Register note seeking through preview transport for video/GIF/sequence and keep general notes available for every asset.**

- [ ] **Step 5: Run focused database/renderer tests until green and commit.**

### Task 3: EXR frame source, multichannel extraction, and LUT state

**Files:**
- Modify: `src/main/services/media/exr-header.ts`
- Modify: `src/main/services/media/openimageio-tools.ts`
- Modify: `src/main/ipc/resources-ipc.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/renderer/components/HdrPreview.tsx`
- Modify: `src/renderer/components/SequencePreview.tsx`
- Create: `src/renderer/components/PreviewColorTools.tsx`
- Test: `tests/unit/main/openimageio-tools.test.ts`
- Test: `tests/unit/renderer/components/SequencePreview.test.tsx`
- Test: `tests/unit/renderer/components/PreviewColorTools.test.tsx`

- [ ] **Step 1: Write failing tests that derive real EXR layers/AOV groups, request each sequence frame with the selected channel, and import `.cube`/`.3dl` LUTs without changing the source.**

- [ ] **Step 2: Verify failures occur because sequence requests omit channel/LUT identity and the toolbar exposes no working color actions.**

- [ ] **Step 3: Extend preview request/cache identity with channel and LUT, expose built-in transforms plus validated external LUT selection, and register actions in the shared session.**

- [ ] **Step 4: Ensure EXR sequences start paused at frame zero and use buffered decoded frames for play, seek, and step.**

- [ ] **Step 5: Run EXR unit/integration tests and commit.**

### Task 4: Palette extraction and eyedropper workspace

**Files:**
- Modify: `src/renderer/components/PreviewColorBar.tsx`
- Modify: `src/renderer/components/ImagePreviewViewport.tsx`
- Modify: `src/renderer/components/FoundToolbar.tsx`
- Modify: `src/renderer/styles/image-review.css`
- Test: `tests/unit/renderer/app/color-palette.test.ts`
- Test: `tests/unit/renderer/components/ImageReviewPreview.test.tsx`

- [ ] **Step 1: Write failing tests for `+` eyedropper activation, sampled color insertion, clear-all, and `<`/`>` extracted-color expansion.**

- [ ] **Step 2: Verify red, then connect canvas/image coordinate sampling to the shared palette state and render it below the viewport.**

- [ ] **Step 3: Verify keyboard labels, 40px hit areas, and no overlay CSS; run tests and commit.**

### Task 5: Video hover scrubbing and GIF range export

**Files:**
- Modify: `src/renderer/components/DirectoryAssetPanel.tsx`
- Modify: `src/renderer/components/VideoPreview.tsx`
- Modify: `src/renderer/components/GifExportStudio.tsx`
- Create: `src/renderer/app/gif-export-range.ts`
- Modify: `src/renderer/styles/directory.css`
- Test: `tests/unit/renderer/components/DirectoryAssetPanel.test.tsx`
- Test: `tests/unit/renderer/components/VideoPreview.test.tsx`
- Test: `tests/unit/renderer/components/GifExportStudio.test.tsx`

- [ ] **Step 1: Write failing tests for hover-position-to-preview-time mapping and a centered five-second range clamped at source boundaries.**

```ts
expect(centeredGifRange(50_000, 120_000)).toEqual({ startMs: 47_500, endMs: 52_500 });
expect(centeredGifRange(1_000, 120_000)).toEqual({ startMs: 0, endMs: 5_000 });
```

- [ ] **Step 2: Verify red, then add cancellable/debounced hover scrubbing and initialize the dual range handles from current playback time.**

- [ ] **Step 3: Wire FPS, 64/128/256 colors, S/M/L/custom resolution, live range labels, size estimate, progress, cancellation, save, and native drag-out.**

- [ ] **Step 4: Run focused renderer and existing main GIF export tests; commit.**

### Task 6: Progressive placeholder and model/DCC thumbnail providers

**Files:**
- Modify: `src/renderer/components/DirectoryAssetPanel.tsx`
- Modify: `src/main/providers/geometry-provider.ts`
- Modify: `src/main/providers/dcc-provider.ts`
- Create: `src/main/services/media/model-thumbnail.ts`
- Create: `src/main/services/media/dcc-thumbnail.ts`
- Modify: `src/main/platform/protocols.ts`
- Test: `tests/unit/main/media-providers.test.ts`
- Test: `tests/unit/main/professional-formats.test.ts`
- Test: `tests/unit/renderer/components/DirectoryAssetPanel.test.tsx`

- [ ] **Step 1: Write failing tests that pending/failed previews show only type icons, OBJ declares thumbnail support, DCC routing prefers embedded/shell/provider output, and `.wrap` stays a fixed icon.**

- [ ] **Step 2: Verify failures, then remove waiting/error copy from cards and retain background prefetch with stale-result rejection.**

- [ ] **Step 3: Add deterministic offscreen OBJ thumbnail generation and cache it through the existing preview-cache key.**

- [ ] **Step 4: Add the guarded DCC chain: embedded preview, Windows `createThumbnailFromPath`, detected DCC background provider, then quiet type-icon fallback. Never launch an unverified executable.**

- [ ] **Step 5: Run provider, thumbnail-cache, protocol, and directory-card tests; commit.**

### Task 7: End-to-end verification and Windows installer

**Files:**
- Modify only files required by failures found during verification.
- Output: `out/make/squirrel.windows/x64/`

- [ ] **Step 1: Run `pnpm typecheck`, focused preview/media suites, then `pnpm check`; fix each root cause with a failing regression test first.**

- [ ] **Step 2: Start the Electron app and inspect normal, focus, and fullscreen at 1280x720 and 1920x1080 with image, video, EXR sequence, OBJ, and fallback assets.**

- [ ] **Step 3: Verify no toolbar overlaps media, every visible action works, AI colors use shared tokens, and saved thumbnails/notes update immediately.**

- [ ] **Step 4: Run `pnpm make` and verify the new Squirrel installer exists under `out/make/squirrel.windows/x64/`.**

- [ ] **Step 5: Review the diff, preserve unrelated deletions, and commit the verified implementation.**
