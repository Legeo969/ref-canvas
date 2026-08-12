# Unified Preview Layout and Thumbnail Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every right-panel file preview use one unobstructed, neutral canvas with all controls below it, and refresh directory thumbnails immediately after a custom thumbnail is saved.

**Architecture:** Extend the existing Found managed-preview contract instead of replacing renderers. `FoundPreviewPanel` owns the bottom workspace and passes a managed-session flag plus renderer controls through a shared viewport/control contract; each renderer hides only its internal chrome when managed. Custom thumbnail saves return an updated `AssetRecord`, emit the existing library change event, and drive a path-scoped thumbnail revision in `DirectoryAssetPanel`.

**Tech Stack:** React 19, TypeScript, Electron IPC, CSS, Vitest

---

### Task 1: Lock the managed preview shell behavior

**Files:**
- Modify: `tests/unit/renderer/components/FoundPreviewPanel.test.tsx`
- Modify: `tests/unit/renderer/components/AssetPreview.test.tsx`
- Modify: `src/renderer/components/FoundPreviewPanel.tsx`
- Modify: `src/renderer/components/AssetPreview.tsx`

- [ ] Add failing tests that render image, EXR/HDR, GIF, video, sequence, audio, PDF, 3D, font, text, and generic assets and assert one `.found-preview-viewport`, no `.workbench-asset-label` overlay, and a filename in `.found-preview-workspace`.
- [ ] Run the focused tests and confirm failures identify the current overlay title and missing shared viewport/workspace.
- [ ] Introduce an explicit `managed`/right-panel preview prop in `AssetPreview`; keep standalone preview behavior unchanged.
- [ ] Restructure `FoundPreviewPanel` to render `PreviewSurface` as the content-only viewport and place the filename plus shared controls in a sibling bottom workspace.
- [ ] Run the focused tests and confirm all renderer routes use the same structural boundary.

### Task 2: Move image and HDR controls below the viewport

**Files:**
- Modify: `tests/unit/renderer/components/ImageReviewPreview.test.tsx`
- Create or modify: `tests/unit/renderer/components/HdrPreview.test.tsx`
- Modify: `src/renderer/components/ImagePreviewViewport.tsx`
- Modify: `src/renderer/components/ImageReviewPreview.tsx`
- Modify: `src/renderer/components/HdrPreview.tsx`

- [ ] Add failing tests proving managed image/HDR sessions expose controls to the parent workspace and do not render `.image-preview-toolbar` or `.hdr-preview-controls` inside the content viewport.
- [ ] Add a small control-slot contract to `ImagePreviewViewport` so standalone sessions render their own toolbar while managed sessions hand the same working controls to `FoundPreviewPanel`.
- [ ] Preserve fit, zoom, rotation, checkerboard, eyedropper, EXR layer/channel, tone mapping, exposure, palette, retry, and export behavior through the moved controls.
- [ ] Ensure EXR canvas and fallback image share one full-size stage and aspect-ratio-preserving fit calculation, with no nested background frame.
- [ ] Run image/HDR tests and verify rapid asset changes reset fit, rotation, channel, exposure, and stale preview state.

### Task 3: Remove duplicate controls for every remaining renderer

**Files:**
- Modify: renderer component tests under `tests/unit/renderer/components/`
- Modify: `src/renderer/components/VideoPreview.tsx`
- Modify: `src/renderer/components/GIFPreview.tsx`
- Modify: `src/renderer/components/SequencePreview.tsx`
- Modify: `src/renderer/components/AudioPreview.tsx`
- Modify: `src/renderer/components/ModelPreview.tsx`

- [ ] Add failing tests asserting managed video/GIF/sequence transport is available only in the bottom workspace, while standalone controls remain present.
- [ ] Extend the managed control contract to audio and 3D so waveform/model content stays unobstructed and renderer-specific controls/actions render below it.
- [ ] Keep PDF, font, text, and unsupported content as single viewport surfaces without inner black frames; show a single compact fallback notice when decoding is unavailable.
- [ ] Preserve functional playback, seeking, looping, frame stepping, mute, GIF/frame export, 3D camera/display actions, screenshot, and “set thumbnail” commands.
- [ ] Run all renderer component tests and verify disabled placeholders remain disabled rather than appearing functional.

### Task 4: Apply the neutral, full-viewport layout

**Files:**
- Modify: `src/renderer/styles/found-preview.css`
- Modify: `src/renderer/styles/directory.css`
- Modify: `src/renderer/styles/image-review.css`
- Modify: existing renderer styles in `src/renderer/styles/dialogs.css` and `src/renderer/styles/board.css` only where managed-session selectors require it

- [ ] Add DOM/class assertions for a content-only viewport and bottom workspace before changing CSS.
- [ ] Remove inherited `42px 26px 18px` preview padding and the isolated `#0F1119` blue-tinted canvas from the Found right panel; use the application's neutral dark surface token.
- [ ] Give the content viewport `flex: 1 1 auto`, `min-width/min-height: 0`, and one overflow boundary; make visual renderers fill it while their media uses `max-width/max-height: 100%` and `object-fit: contain`.
- [ ] Remove overlay positioning for filename, frame/sequence labels, renderer controls, and notes actions in the managed session; place status text in reserved workspace rows or a non-content fallback state.
- [ ] Keep transparent-media checkerboard opt-in, use a subtle white image outline, preserve 40px hit areas where feasible, specify transition properties, and use tabular numerals for time/FPS/exposure.
- [ ] Run focused tests and typecheck.

### Task 5: Refresh custom thumbnails in the middle directory grid

**Files:**
- Modify: `tests/unit/main/system-ipc.test.ts` or the nearest existing system IPC test
- Modify: `tests/unit/renderer/components/DirectoryAssetPanel.test.tsx`
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/ipc/system-ipc.ts`
- Modify: `src/renderer/components/ModelPreview.tsx`
- Modify: `src/renderer/components/DirectoryAssetPanel.tsx`

- [ ] Add a failing main-process test proving thumbnail-mode `saveRenderedImage` returns the updated asset and emits a library change for that asset.
- [ ] Add a failing renderer test proving a matching `library.onLibraryChanged` event replaces the directory card source with `asset.thumbnailUrl` plus `updatedAt` revision, without reloading unrelated cards.
- [ ] Change the thumbnail-mode IPC return type from a filename to `AssetRecord`; retain the export-mode filename return as a discriminated result so callers cannot confuse the two modes.
- [ ] Route the database update through a library-service method that emits the existing `LibraryChangedEvent`, avoiding a second event system.
- [ ] Subscribe `DirectoryAssetPanel` to library changes, keep a path-to-thumbnail-revision map, and pass the revision into `DirectoryCard`; on matching updates, prefer the indexed asset thumbnail URL and reset retry state.
- [ ] Update `ModelPreview` success handling to consume the typed result and report success only after the updated asset is returned.
- [ ] Run the focused main/renderer tests, including repeated thumbnail updates and unrelated-path events.

### Task 6: Regression and visual verification

**Files:**
- Modify only tests or styles required by failures found in this task.

- [ ] Run all preview and directory component tests with `pnpm vitest run tests/unit/renderer/components`.
- [ ] Run main IPC, protocol, thumbnail-cache, and library-service tests.
- [ ] Run `pnpm typecheck`, `pnpm lint`, and full `pnpm check`.
- [ ] Run `pnpm package` and the packaged runtime smoke test.
- [ ] Start the Electron app and capture right-panel screenshots for image, EXR/HDR, video, audio, PDF, 3D, text, and unsupported files at 1280x720 and 1920x1080.
- [ ] Verify each screenshot has one neutral canvas, no controls over file content, no nested black frames, preserved aspect ratio, and a working bottom workspace; verify custom thumbnail changes appear in the middle grid without navigation or restart.

## Assumptions

- The workspace's current uncommitted Found preview changes are intentional and must be preserved and completed in place.
- “All files” covers every existing renderer plus the unsupported fallback; adding new proprietary decoders is out of scope.
- Visual media uses Fit/contain without cropping or stretching. Unused space is the application's neutral canvas.
- Existing fullscreen/focus, exports, EXR controls, 3D controls, notes, palette extraction, and retry behavior remain supported.
