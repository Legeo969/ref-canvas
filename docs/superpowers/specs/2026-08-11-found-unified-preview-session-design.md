# Found-style unified preview session

## Goal

Make every preview entry behave like Found while keeping media-specific rendering isolated. Images, EXR/HDR, video, audio, PDF, 3D, fonts, and generic files use one preview-session shell instead of accumulating unrelated controls in each renderer.

## Entry-point responsibilities

### Main details preview

- Show the selected asset and a single non-wrapping preview toolbar.
- Keep only view controls and media controls that act directly on the visible asset.
- Palette swatches stay inline. Selecting or sampling a color never opens a secondary color workbench or drawer.
- Eyedropper mode changes the cursor to a crosshair, samples the next visible pixel, shows a compact HEX result in the toolbar, and copies it on click.
- Provide focus preview and fullscreen buttons for every asset type.

### Space quick preview

- Applies to every asset type.
- Shows the asset, filename, path, type, size, dimensions/duration, and provider metadata.
- Keeps previous, next, and close navigation only.
- Removes favorite, rating, color label, reveal, external-open, floating-window, editing, export, and AI actions.

### Floating preview window

- Uses the same preview-session shell and media renderer as the main preview.
- Provides focus preview and fullscreen controls.
- Escape exits fullscreen first, then focus preview, then closes the floating window.

## Focus and fullscreen

- Focus preview hides the directory tree, asset grid, AI panel, tabs, and other application chrome while retaining the current asset and its preview toolbar.
- Fullscreen uses the browser/Electron fullscreen surface and contains only the focused preview.
- Escape unwinds nested state in this order: fullscreen, focus preview, quick/floating preview.
- State resets when the selected asset changes.

## Shared architecture

- `PreviewSessionShell` owns focus/fullscreen state, Escape handling, header actions, and consistent layout.
- Existing renderers (`ImageReviewPreview`, `HdrPreview`, `VideoPreview`, audio, PDF, 3D, font, generic) remain responsible only for rendering and media-specific controls.
- `ImagePreviewViewport` remains the shared pan/zoom implementation for raster and HDR content.
- The main details panel no longer changes to a color tool when image/video palette actions fire.
- The Space overlay uses a dedicated read-only details composition rather than the editable asset-management footer.

## Eyedropper behavior

- Raster images sample their displayed source through an in-memory canvas.
- Video samples the current displayed frame.
- Canvas-backed visual formats sample the rendered canvas when browser security permits.
- Unsupported/non-visual formats hide the eyedropper instead of showing a broken control.
- Sampling never mutates the source file and never opens another panel.

## EXR correction

- Increment the preview cache generation version so gray FFmpeg proxies are not reused after upgrading to the OpenEXR decoder.
- Reset every EXR asset session to Auto layer plus Composite/Beauty.
- R/G/B/A remain explicit diagnostic choices and never become the next asset's default.
- Thumbnail, main preview, Space preview, and floating preview consume the regenerated Beauty proxy.
- Validate against the reported Unreal PIZ multi-channel EXR, including non-flat pixel statistics and visual output.

## Error handling

- Preview decode failures stay inside the preview surface with a concise format-specific error.
- Failed focus/fullscreen requests leave the current mode unchanged.
- A stale/failed EXR cache record is superseded by the new cache generation and is not treated as authoritative.

## Testing and release acceptance

- Unit tests cover preview-session Escape ordering and state reset.
- Component tests cover the simplified all-format Space preview and absence of management actions.
- Image/video tests prove color selection remains inline and does not open the workbench.
- EXR tests cover cache-version invalidation and Auto + Composite reset.
- Run repository hygiene, lint, typecheck, the full test suite, package smoke, packaged runtime smoke, and a real Unreal EXR decode.
- Rebuild `out/RefCanvas-win32-x64` and verify the executable and `app.asar` timestamps.
