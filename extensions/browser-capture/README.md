# RefCanvas Browser Capture

Chrome/Edge extension (Manifest V3) that lets you right-click any image on the web and send it directly to a RefCanvas reference board.

## Features

- **Right-click → Add to RefCanvas**: context menu on any `<img>` sends the image to your active board.
- **Capture page screenshot**: context menu on any page sends a full-page visible screenshot.
- **Connection status popup**: shows whether RefCanvas is running and which board is active.

## How it works

```
Browser extension                RefCanvas (Electron)
┌───────────────┐               ┌──────────────────┐
│  Right-click  │   POST         │  HTTP server     │
│  image on     │  base64 ──→   │  127.0.0.1:17530 │
│  any webpage  │               │  /capture         │
└───────────────┘               └───────┬──────────┘
                                        │ writes temp file
                                        │ sends IPC to renderer
                                        ▼
                                ┌──────────────────┐
                                │  addDirectory-   │
                                │  EntriesToBoard  │
                                │  → active board  │
                                └──────────────────┘
```

The extension talks to RefCanvas via a local HTTP endpoint (`127.0.0.1:17530`) that the app starts automatically. No external network calls are made.

## Installation (development)

1. **Build RefCanvas** with the capture server (already integrated in the main process).
2. **Load the extension** in Chrome/Edge:
   - Navigate to `chrome://extensions` (or `edge://extensions`)
   - Enable **Developer mode** (top-right toggle)
   - Click **Load unpacked**
   - Select the `extensions/browser-capture/` directory
3. **Pin the extension** to your toolbar for quick access.
4. **Right-click any image** on a webpage → **Add to RefCanvas**.

## Extension structure

```
extensions/browser-capture/
  manifest.json       — MV3 manifest
  background.js        — service worker (context menu, fetch, POST to RefCanvas)
  popup.html           — connection status UI
  popup.js             — popup logic (check /status endpoint)
  icons/               — 16/48/128px icons
  generate-icons.cjs   — regenerates icons from SVG (run with `node generate-icons.cjs`)
```

## Configuration

The extension connects to `http://127.0.0.1:17530` by default. If you need a different port, update `REFCANVAS_BASE` in `background.js` and the `port` argument in `src/main/index.ts`.

## Permissions explained

| Permission | Why |
|---|---|
| `contextMenus` | Register "Add to RefCanvas" right-click item |
| `activeTab` | Access the current tab when the user invokes the extension |
| `scripting` | Inject a content script to fetch cross-origin images |
| `storage` | Save extension settings (future use) |
| `host_permissions: localhost:17530` | Talk to the RefCanvas local server only |

The extension does **not** request `<all_urls>` — it only fetches images via the page's own context (content script), not from the service worker directly.

## Privacy

- All communication is local (`127.0.0.1` only).
- No data leaves the machine.
- The extension does not track, store, or forward browsing data.
