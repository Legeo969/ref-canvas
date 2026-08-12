# Capability-driven Media Preview Design

Date: 2026-08-13

## Goal

Build one consistent preview experience for images, video, image sequences, EXR, 3D assets, DCC projects, and unsupported files. The preview must preserve the functional arrangement of the supplied Found references and the user's layout reference without requiring pixel-for-pixel copying.

## Shared Interaction Model

- A single click updates the right preview immediately.
- A double click opens focus mode.
- Focus mode keeps the application frame, filename, and complete bottom tool workspace.
- Fullscreen hides the browser, AI panel, and other application UI. It shows only the asset, filename, and controls required for that asset.
- Every visual asset opens in `fit` mode. It is fully visible, keeps its aspect ratio, and is never cropped by the viewport.
- Controls live below the media viewport and never overlay the asset.
- The AI panel, preview surfaces, and toolbars use the application's shared theme tokens rather than isolated blue or gray surfaces.

## Capability-driven Preview Session

All formats use one preview-session state model for selection, fit/zoom, focus, fullscreen, playback, timeline position, and bottom controls. A renderer adapter declares the capabilities supported by the current asset, so the shared toolbar exposes only working actions.

Changing assets resets renderer-local state. Async work is keyed to the active asset so stale thumbnail, frame, or metadata results cannot replace the current selection.

## Thumbnail Pipeline

- Thumbnail work is progressive, asynchronous, cached on disk, and deduplicated.
- While generation is pending, cards show a quiet file-type or folder icon. They never show black boxes or waiting/loading copy.
- Generated thumbnails silently replace placeholders and remain available on later visits.
- Video thumbnails use a representative decoded frame and support Found-style hover scrubbing.
- `.obj` assets are parsed and rendered offscreen automatically to produce model thumbnails.
- DCC formats such as `.c4d`, `.blend`, `.max`, `.ma`, and `.mb` automatically attempt, in order: embedded preview extraction, Windows shell/installed thumbnail provider, then a supported installed DCC background renderer. Results are cached.
- Proprietary formats with no available preview provider, such as `.wrap`, retain a fixed format icon.
- Saving a custom thumbnail publishes a thumbnail revision so the middle asset grid updates immediately without navigation or restart.

## Images, Video, and Sequences

- Images use aspect-preserving contain layout with zoom and restore-to-fit.
- Videos open paused and provide play/pause, frame stepping, timeline scrubbing, loop, volume, speed, fit/zoom, LUT, and fullscreen.
- Unsupported native video codecs use an FFmpeg-generated proxy for preview; the source is unchanged.
- Image and EXR sequences open on the first frame and play only after the user presses Play.
- Sequence transport provides play/pause, previous/next frame, first/last frame, loop, FPS, timeline scrubbing, fit/zoom, LUT, and fullscreen.
- EXR playback decodes the selected frame through an EXR frame-source adapter rather than treating the sequence as a browser-native video.

## EXR Multichannel and Color Management

- Replace the simple RGB/R/G/B/A selector with `Extract channels`.
- Read the channels, layers, passes, and AOVs that actually exist in the EXR and allow each valid grouping to be previewed.
- LUT controls include built-in color spaces, built-in looks, and imported `.cube` and `.3dl` files.
- LUT and color transforms affect preview output only and never modify the source.

## Color Bar

- `+` enters eyedropper mode and adds a sampled preview color to the palette.
- `Clear colors` removes all sampled colors.
- `<` expands colors extracted from the current image; the control becomes `>` while expanded and collapses the row when pressed again.
- The color bar remains in the bottom workspace and cannot cover media.

## GIF Export

- Video and playable sequences can export GIF through the bottom workspace.
- Opening GIF export selects a five-second range centered on the current playback position. Near either boundary, the range shifts to remain inside the source duration.
- Left and right range handles let the user change the exact export segment. The selected range is highlighted and its start/end time or frame values update live.
- Controls include FPS presets/custom FPS, 64/128/256 colors, S/M/L and custom resolution, output-size estimation, export progress, and cancellation.
- Exported GIFs can be saved or dragged out of the application.

## Functional Layout

Normal mode keeps the directory browser visible and uses this vertical order in the right panel:

1. Preview/AI tab header.
2. Filename/title.
3. One unobstructed media viewport.
4. Primary transport and timeline.
5. Format-specific controls, LUT, color palette, and export settings.

The layout has stable heights and responsive constraints so controls do not shift or overlap at supported desktop sizes.

## Verification

- Test capability mapping and disabled/hidden actions for image, video, EXR, sequence, 3D, DCC, and fallback assets.
- Test single-click preview, double-click focus, distinct focus/fullscreen layouts, and reset-to-fit on asset changes.
- Test video hover scrubbing and proxy fallback.
- Test EXR sequence playback, frame stepping, multichannel extraction, built-in/imported LUT selection, and non-destructive color transforms.
- Test eyedropper add, clear colors, and palette expand/collapse.
- Test GIF's centered five-second default range, boundary clamping, range-handle updates, settings, progress, and cancellation.
- Test thumbnail placeholders, OBJ/DCC generation routing, cache reuse, stale-result rejection, and immediate custom-thumbnail refresh in the middle grid.
- Run focused Vitest suites, full typecheck/lint/test checks, package the Windows application, and inspect desktop screenshots at 1280x720 and 1920x1080.

## Constraints

- DCC thumbnail generation depends on an embedded preview, installed shell provider, or installed compatible DCC application. When none exists, the application must fall back quietly to a fixed type icon.
- Preview proxies, LUTs, thumbnails, and GIF output never overwrite source assets.
