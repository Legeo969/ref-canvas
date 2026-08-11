# Found Image Preview Parity Design

## Objective

Make RefCanvas image preview interactions match the supplied Found references across the main preview pane, directory quick preview, overlay quick preview, and standalone preview window. The work covers browser-decodable images and EXR/HDR assets. It does not redesign the directory grid, video controls, or AI workbench.

## Confirmed Problems

### Standard images

- The image canvas starts with the transparency checkerboard enabled, including for opaque JPEG files.
- The main image review component has no wheel handler. Quick preview has a separate Ctrl+wheel transform that scales the entire preview subtree instead of the image viewport.
- The component claims to support panning, but no pan interaction is implemented.
- The toolbar wraps and mixes view controls, sampling tools, palette swatches, and status text without stable grouping.
- Zoom behavior differs between preview entry points.

### EXR

The current EXR provider asks the bundled FFmpeg 6.1.1 binary to generate a tone-mapped PNG proxy. A representative Unreal Engine image is a 2650 x 1080, 16-bit, PIZ-compressed EXR with an unlayered RGBA beauty image plus multiple float auxiliary layers. FFmpeg reports unsupported auxiliary channels and repeated `decode_block() failed` errors, then emits a flat gray PNG. The same failure occurs with FFmpeg 8.1.1, so replacing the bundled FFmpeg version alone is not sufficient.

Three.js `EXRLoader` supports PIZ, but a direct full-file decode of this 111 MB multi-channel image did not complete within two minutes because it processes far more data than the display layer requires. Full EXR decoding must therefore be cancellable, off the renderer thread, and selective about layers and channels.

## Chosen Architecture

### Shared image viewport

Create one image viewport/controller used by all image preview entry points. It owns only view state and gestures:

- zoom mode (`fit` or explicit scale);
- zoom scale, clamped to 10%-800%;
- pan offset;
- rotation;
- transparency-background visibility;
- pointer gesture state.

Browser images and decoded HDR/EXR display surfaces consume this viewport state. Asset-specific tools such as tone mapping, layer/channel selection, color sampling, and notes remain outside the viewport controller.

Switching assets resets the viewport to fit, centered, zero rotation, and a dark solid canvas. The transparency checkerboard remains available as an explicit toggle and uses the configured Alpha background only while enabled.

### Gestures

- Plain mouse-wheel input over the canvas zooms the image; no modifier key is required.
- Zoom is centered on the pointer position so the inspected detail stays under the cursor.
- At explicit zoom levels, primary-button drag pans the image. Panning is disabled in fit mode until the user zooms.
- Double-click restores fit and center.
- Wheel events handled by the viewport do not bubble into quick-preview outer transforms or page scrolling.
- The existing quick-preview Ctrl+wheel image wrapper is removed to prevent nested zoom systems.

### Zoom controls

The toolbar exposes a compact zoom menu matching the Found interaction model:

- Auto
- 25%
- 50%
- 100%
- 200%

Wheel zoom may land between presets, and the displayed percentage uses tabular numerals. Existing zoom-in, zoom-out, fit, and 100% actions may call the same viewport controller, but duplicate visible controls are removed.

### Toolbar layout

Use a fixed, non-wrapping bottom toolbar with two stable groups:

- Left: zoom menu, fit/center, rotate, transparency background, and image-only contextual actions.
- Right: eyedropper/sample state, extracted palette, notes/layers, and lower-frequency actions.

Visible icon buttons retain at least 40 x 40 px hit areas even when their glyphs remain visually compact. Palette swatches no longer force primary view controls to move or wrap. When horizontal space is insufficient, lower-frequency actions move into an overflow menu rather than creating a second toolbar row.

## EXR/HDR Decode Pipeline

### Backend boundary

Introduce a decode backend boundary in the provider worker. The UI requests a display proxy by file path, selected layer/channel, target dimensions, and display-transform parameters. The worker returns a cacheable bitmap/PNG result or a structured error.

### EXR backend

Use a worker-hosted OpenEXR-capable decoder that supports PIZ and selective layer/channel reads. The approved implementation direction is the `exrs` WebAssembly package because it supports Node/browser execution, arbitrary channels, PIZ compression, and reading selected image sections. Only the chosen RGB(A) display layer is materialized; auxiliary motion-vector, mask, depth, position, and normal layers are skipped unless explicitly selected.

The dependency must pass a focused compatibility spike against the representative Unreal PIZ multi-channel file before replacing the current path. If the spike cannot produce the beauty layer within the existing 60-second provider deadline, implementation stops at the backend boundary and reports the measured blocker rather than shipping an unresponsive decoder.

Radiance HDR may continue using the existing FFmpeg path when it succeeds, but its output is presented through the same viewport and toolbar.

### Color display

Decoded scene-linear RGB is converted to a display-referred bitmap using the selected tone mapping and exposure. Existing ACES, Reinhard, and Neutral options remain. Changing the display transform invalidates only the corresponding proxy variant, not unrelated thumbnails.

### Caching and cancellation

- Cache keys include the source fingerprint, selected layer/channel, target size, tone mapping, exposure, and LUT signature.
- A new asset selection aborts the previous decode request and discards late results.
- Decode work remains outside the renderer thread.
- The existing FFmpeg route remains as a fallback for simple EXR files while the selective decoder is unavailable, but a flat gray or structurally invalid output is treated as failure rather than success.

### Errors

The UI distinguishes unsupported compression/channel data, decode timeout, corrupt source, missing runtime, and GPU/display failure. When a cached or lightweight proxy exists, it remains visible while enhanced display processing fails. Error text provides a retry action and never replaces a valid fallback with an empty canvas.

## Component Boundaries

- `ImagePreviewViewport`: shared view state, transforms, gestures, and canvas background.
- `ImagePreviewToolbar`: Found-aligned grouping, zoom menu, overflow handling, and accessible controls.
- `ImageReviewPreview`: standard-image tools and sampling wired to the shared viewport.
- `HdrPreview`: EXR/HDR layer, tone-mapping, exposure, and export tools wired to the same viewport.
- Provider worker decode backend: selective EXR decode, display transform, caching, cancellation, and structured failures.

These units communicate through typed props and existing IPC contracts. The viewport never knows how an image is decoded, and the decode backend never owns UI state.

## Accessibility and Interaction Quality

- Every icon-only action keeps an accessible name and tooltip.
- Keyboard focus remains visible.
- Dynamic zoom values use tabular numerals.
- Transform transitions remain short and interruptible and are disabled under reduced-motion preferences.
- Buttons keep the existing 0.96 press feedback.
- Image edges retain a subtle pure-white outline on the dark canvas.

## Verification

### Automated

- Unit-test wheel zoom direction, pointer-centered zoom math, clamping, drag pan, fit reset, and asset-change reset.
- Assert that the checkerboard starts disabled and toggles explicitly.
- Assert that quick preview no longer applies a second image transform.
- Test the zoom preset menu and toolbar overflow behavior.
- Add provider tests for PIZ multi-channel EXR beauty-layer decoding, auxiliary-layer selection, cancellation, caching, and structured failures.
- Keep the existing known-value HDR/EXR color transform tests.
- Run type checking, linting, targeted renderer/provider tests, and the full test suite.

### Manual acceptance

- Compare the main pane, directory quick preview, overlay quick preview, and standalone window against the supplied Found screenshots.
- Confirm plain-wheel zoom, pointer anchoring, drag pan, double-click fit, preset zoom selection, dark default canvas, and optional checkerboard.
- Confirm the representative Unreal PIZ multi-channel EXR displays its beauty image rather than a flat gray proxy, and that changing layers/channels remains responsive.
- Confirm JPEG, transparent PNG, rotated images, and EXR/HDR all preserve source files byte-for-byte.

## Non-goals

- Pixel-identical recreation of Found branding or unrelated application chrome.
- Changes to video, GIF, sequence playback, directory-grid sizing, or board navigation.
- Writing display transforms or annotations back into source image files.
