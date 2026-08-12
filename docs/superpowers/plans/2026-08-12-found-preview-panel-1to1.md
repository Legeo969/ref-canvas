# Found Preview Panel 1:1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Found-style right preview panel for eight asset types with one synchronized toolbar, the embedded AI panel, and evidence-based visual parity.

**Architecture:** `FoundPreviewPanel` owns the selected preview session and renders a type-derived toolbar. Media renderers expose playback state and commands through a shared transport contract, while `AssetPreview` remains the renderer router. Format-specific rendering stays inside focused components.

**Tech Stack:** React 19, TypeScript, Vitest, Electron, Three.js, CSS

---

### Task 1: Preview classification and toolbar model

**Files:**
- Create: `src/renderer/components/found-preview-model.ts`
- Create: `tests/unit/renderer/components/found-preview-model.test.ts`
- Modify: `src/shared/contracts.ts`

- [x] Add failing tests for SVG/GIF/sequence precedence, timecode formatting, progress colors, and per-type toolbar capabilities.
- [x] Run the focused test and confirm it fails because the model does not exist.
- [x] Implement the minimal pure model and optional renderer-only `DirectoryEntry.sequenceGroup` field.
- [x] Run the focused test and typecheck.

### Task 2: Shared preview transport

**Files:**
- Create: `src/renderer/components/PreviewTransport.tsx`
- Create: `tests/unit/renderer/components/PreviewTransport.test.tsx`
- Modify: `src/renderer/components/AssetPreview.tsx`
- Modify: `src/renderer/components/VideoPreview.tsx`
- Modify: `src/renderer/components/GIFPreview.tsx`
- Modify: `src/renderer/components/SequencePreview.tsx`

- [x] Add failing tests proving external seek, loop, rate, mute, volume, and frame stepping reach each renderer.
- [x] Add the context contract and renderer adapters, keeping standalone previews backward compatible.
- [x] Remove Found-only duplicate media controls while retaining controls outside the Found session.
- [x] Run focused media tests and typecheck.

### Task 3: Variant-driven toolbar and right-panel sequence flow

**Files:**
- Modify: `src/renderer/components/FoundToolbar.tsx`
- Modify: `src/renderer/components/FoundSlider.tsx`
- Modify: `src/renderer/components/FoundPreviewPanel.tsx`
- Modify: `src/renderer/components/DirectoryAssetPanel.tsx`
- Modify: `tests/unit/renderer/components/FoundPreviewPanel.test.tsx`

- [x] Add failing tests for the five toolbar variants and direct sequence rendering.
- [x] Drive the toolbar from the shared transport snapshot and commands.
- [x] Pass detected sequence groups through the selected directory entry and render `SequencePreview` in the right panel.
- [x] Verify asset changes reset session state and stale async metadata cannot replace the current asset.

### Task 4: Eight renderer surfaces

**Files:**
- Modify: `src/renderer/components/AssetPreview.tsx`
- Modify: `src/renderer/components/AudioPreview.tsx`
- Modify: `src/renderer/components/ModelPreview.tsx`
- Create: `src/renderer/components/FoundLayersPanel.tsx`
- Modify: `src/renderer/styles/found-preview.css`
- Modify: relevant component tests under `tests/unit/renderer/components/`

- [x] Add failing tests for SVG Layers, PDF paper, audio metadata, model camera presets, overlays, and renderer-specific toolbar behavior.
- [x] Implement SVG `Layers (0)`, image alpha/grid presentation, GIF/video/sequence overlays, audio metadata, PDF paper framing, and five 3D presets.
- [x] Keep LUT/ACES, `C`, and unknown Found commands explicit disabled placeholders.
- [x] Run all renderer component tests and typecheck.

### Task 5: AI panel and visual convergence

**Files:**
- Modify: `src/renderer/components/AiDesignSupervisor.tsx`
- Modify: `src/renderer/styles/ai.css`
- Modify: `src/renderer/styles/found-preview.css`
- Modify: `tests/unit/renderer/components/AiDesignSupervisor.test.tsx`

- [x] Add failing structure tests for empty and populated AI states.
- [x] Match the upload, source, feedback, attachment, and bottom-action regions without changing task submission behavior.
- [x] Calibrate the measured palette and 36/28/24px geometry; retain focus, fullscreen, keyboard, localization, and accessible names.
- [x] Audit explicit transitions, tabular numerals, image outlines, optical icon alignment, and non-overlapping hit targets.

### Task 6: Verification

- [x] Run focused component tests and `pnpm typecheck`.
- [x] Run `pnpm check`.
- [x] Run `pnpm package` and `pnpm test:runtime`.
- [x] Capture representative Found panel states at 1692x900 and run responsive checks at 1280x720 and 1920x1080; fixture-backed renderer states remain covered by component tests.
- [x] Sample `#242424`, `#2E2E2E`, `#0085FF`, and `#59D165`, and retain tested Three.js camera presets and canvas rendering.

**Assumptions:** Real LUT/ACES processing and SVG layer parsing remain out of scope. Existing PDF rendering, local media decoding, export tools, focus/fullscreen behavior, and user deletion of the superseded execution plan are preserved.
