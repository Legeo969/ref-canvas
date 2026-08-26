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

## Troubleshooting

Captures show an `ERR` badge or never land on the board:

1. **Open the popup** — it shows the exact text of the last failure (stage + message + time), no DevTools needed.
2. **RefCanvas must be running** (it can sit in the system tray with its window closed). The popup should say *Connected*.
3. **Chrome may block access to local apps** — newer Chrome versions gate requests to loopback addresses behind a *Local Network Access* permission and require the server to answer CORS preflights with `Access-Control-Allow-Private-Network: true`. This is why a same-machine `curl http://127.0.0.1:17530/status` can succeed while every capture fails: curl skips the browser's preflight, and it is exactly that preflight which gets rejected. If Chrome shows a local-network prompt for RefCanvas, choose **Allow**.
4. **Port occupied** — if another program holds port 17530, RefCanvas shows a tray notification and capture stays unavailable until it is freed (a reboot clears crashed leftovers).
5. Some images are hotlink-protected or session-bound and genuinely cannot be extracted; use **Capture page to RefCanvas** as a fallback.
6. Captures made while the board window was closed are queued by the app (a tray balloon says so) and imported automatically next time RefCanvas opens.

## Permissions explained

| Permission | Why |
|---|---|
| `contextMenus` | Register "Add to RefCanvas" right-click item |
| `activeTab` | Access the current tab when the user invokes the extension |
| `scripting` | Inject a content script to fetch cross-origin images |
| `storage` | Save extension settings (future use) |
| `host_permissions: localhost:17530` | Talk to the RefCanvas local server only |

The service worker tries a direct CORS fetch first (fast path for same-origin / CORS-enabled images) and falls back to injecting a content script that fetches the image from the page's own context, so no `<all_urls>` host permission is needed.

## Privacy

- All communication is local (`127.0.0.1` only).
- No data leaves the machine.
- The extension does not track, store, or forward browsing data.
