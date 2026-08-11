# EXR retry and fullscreen lifecycle correction

## Problem

The reported Unreal PIZ EXR decodes correctly and a valid non-flat PNG is
written to the versioned preview cache. The UI can still remain gray or black
when its first `refbrowse://thumbnail` request is cancelled or fails while the
expensive proxy is being generated. The image element records that transient
failure as permanent and does not request the now-valid cache file again.

The fullscreen reset effect also compares two nullable values. Before the
preview root mounts, both `document.fullscreenElement` and `rootRef.current`
are `null`, so the effect incorrectly calls `document.exitFullscreen()` and
Electron reports `Document not active`.

## Selected approach

Use bounded renderer-side retries for cache-backed previews and strictly guard
Fullscreen API calls. This preserves the existing provider queue and v5 cache,
avoids pre-generating hundreds of EXRs, and recovers automatically when a
proxy finishes after the first browser request.

## Preview loading state machine

A shared cache-backed preview URL helper owns four observable states:

- `loading`: the initial request or a scheduled retry is in progress.
- `ready`: the media element decoded successfully; retries stop.
- `waiting`: a transient failure occurred and the next retry is scheduled.
- `failed`: the bounded retry budget is exhausted; show an explicit retry
  control instead of a permanent blank rectangle.

Retries append a nonce query parameter that does not participate in the
server-side preview cache identity. They therefore issue a fresh browser
request while resolving to the same generated PNG. Automatic retries use a
short bounded backoff and are cancelled when the asset, layer, channel, or
component unmounts or changes. Manual retry resets the retry budget.

Directory cards and EXR/HDR preview surfaces use the same behavior. A card
keeps a neutral loading placeholder during generation and swaps to the image
when ready. The main EXR preview keeps the filename and controls stable while
the image is pending, then replaces the loading surface without resetting the
user's zoom.

## Fullscreen lifecycle

Fullscreen exit is permitted only when all conditions are true:

- the preview root exists;
- the document is active;
- `document.fullscreenElement` is exactly that preview root;
- `document.exitFullscreen` is available.

State reset never calls `exitFullscreen()` for two `null` values. Failed
fullscreen requests are caught locally and must not produce a global toast.
Escape continues to unwind fullscreen, then focus preview, then close.

## Error handling and accessibility

- Loading and waiting states use concise status text rather than a blank gray
  proxy.
- The final failure state offers a 40×40 px minimum retry target.
- Retry and fullscreen controls retain clear Chinese accessible names.
- Status transitions use opacity only and respect reduced-motion settings.
- No source file or existing cache entry is deleted.

## Verification

- Unit-test the nullable fullscreen-root regression and inactive-document
  behavior.
- Unit-test retry success after an initial media error, retry exhaustion,
  manual retry, and cancellation on asset change.
- Component-test directory thumbnails and EXR/HDR previews recovering from a
  transient first failure.
- Re-run the real 111 MB Unreal PIZ EXR decode and validate non-flat PNG stats.
- Run repository hygiene, lint, typecheck, all tests, package smoke, packaged
  runtime smoke, then rebuild and launch `out/RefCanvas-win32-x64`.

## Self-review

The design has no placeholders. Retry behavior is bounded, does not mutate
source files or cache identity, and applies to both thumbnail and main-preview
entry points shown in the report. Fullscreen guards cover the exact null/null
comparison that produced the screenshot error.
