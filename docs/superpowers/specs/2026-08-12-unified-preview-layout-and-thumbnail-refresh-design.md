# Unified Preview Layout and Thumbnail Refresh Design

## Goal

Fix the right preview panel so every supported file type uses one unobstructed media viewport, one bottom control workspace, and a thumbnail pipeline that updates the directory grid immediately after a custom thumbnail is saved.

## Confirmed Layout

- Use the selected B layout: tab header, unobstructed content viewport, then a fixed bottom workspace.
- Move the filename, zoom/fit controls, playback controls, format-specific controls, and palette swatches below the viewport. No label, toolbar, transport, or action button may overlay file content.
- Remove the gray preview mock background. Render only the file content over the application's neutral dark canvas. Transparent media may show the checkerboard only when the existing checker toggle is enabled.
- Size visual media with aspect-ratio-preserving `contain` behavior against the full available viewport. Never stretch or crop. Any unused area is the single panel canvas, not nested black frames.
- Replace the isolated dark-blue preview surface with the application's existing neutral panel/canvas colors.

## File-Type Behavior

- Images, SVG, GIF, video, image sequences, EXR/HDR, PDF, 3D, fonts, text, audio, and generic files all use the same structural shell.
- Image-like, video, sequence, PDF, and model renderers receive the full viewport and keep their native aspect ratio. Their existing internal toolbars are suppressed in the managed right-panel session and exposed through the bottom workspace where functional equivalents exist.
- EXR/HDR layer, channel, tone mapping, exposure, and export controls move below the viewport without reducing the image to a nested inner frame.
- Audio keeps its waveform and metadata in the content viewport and uses bottom transport controls where available.
- Text, font, PDF, 3D, and unsupported previews use renderer-specific content or a single compact fallback state; they must not create extra black rectangles or overlay controls.
- File changes reset renderer-local state and stale async preview results cannot replace the newly selected file.

## Functional Fixes

- Wire bottom controls to real renderer actions through the shared preview transport; unavailable actions remain visibly disabled instead of silently failing.
- Preserve retry behavior for formats whose thumbnail generation is asynchronous, including EXR/HDR and large video files.
- After `saveRenderedImage(..., { mode: "thumbnail" })` succeeds, return the updated asset and publish a renderer-visible thumbnail revision. Directory cards refresh their thumbnail URL with that revision so protocol/browser caches cannot keep the previous image.
- Ensure custom thumbnail lookup applies to the middle directory grid as well as indexed-library views. Keep source preview URLs unchanged when only the thumbnail changes.

## Verification

- Component tests assert that managed previews have no internal/overlay controls, the filename is in the bottom workspace, and every renderer is mounted inside one shared viewport.
- Layout/model tests assert `contain` sizing, neutral canvas tokens, and toolbar capability differences for all supported file kinds.
- Regression tests prove a saved custom thumbnail changes the directory-card thumbnail URL/revision without requiring navigation or app restart.
- Media tests cover image, EXR/HDR, GIF, video, sequence, audio, PDF, 3D, font/text, and unsupported fallback states, including rapid selection changes and failed preview retries.
- Run focused Vitest suites, full `pnpm check`, packaging, and desktop screenshots at 1280x720, 1920x1080, plus the user's 1920x1080-style three-column layout.

## Assumptions

- “All files” means every preview route currently supported by RefCanvas plus the generic unsupported fallback; it does not add decoders for entirely unsupported proprietary formats.
- The selected behavior is `contain/Fit`: maximize the whole file without cropping or distortion. Empty aspect-ratio space uses the application canvas color.
- Existing LUT/ACES processing, EXR channel export, video/GIF export, 3D camera presets, fullscreen, focus mode, and retry actions remain functional.
