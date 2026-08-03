# RefCanvas architecture and quality gates

## Boundaries

```text
renderer (React/Zustand)
  -> window.refCanvas
preload (capability bridge)
  -> typed IPC contracts
main (Electron composition root)
  -> services
  -> persistence repositories
  -> platform adapters / workers
shared (platform-independent contracts and pure logic)
```

- `src/renderer` uses system capabilities only through `window.refCanvas`. It may
  import from an explicit allowlist of browser-safe packages (react, react-dom,
  three, fabric, zustand, lucide-react, zod) and nothing else — every node
  builtin, native addon, and Electron import is denied by default.
- `src/preload/index.ts` is the only renderer capability bridge. It may reach
  Electron and the shared contracts, but no native/node modules, and it exposes
  exactly one contract-typed namespace (`refCanvas`) over the context bridge —
  never a raw `ipcRenderer`/`webUtils`/`process` handle.
- `src/main` may depend on `src/shared`, but never on renderer code.
- `src/shared` cannot depend on Electron, Node, main, or renderer code (zod is the
  only permitted external package).
- IPC registration goes through `src/main/platform/secure-ipc.ts` and validates the sender.
- Every `BrowserWindow` across all of `src/main` reuses the policy in
  `src/main/platform/window-security.ts`; inline `webPreferences` are forbidden.

The boundary allowlists are enforced by `tests/architecture/layers.test.ts` (module
graph) and mirrored per-file by ESLint `no-restricted-imports` in
`eslint.config.mjs` (fails fast in the editor). Allowlists, not blocklists: a new
dependency is denied until it is consciously added, so the gate cannot silently
drift as `package.json` grows.

## Main process

`src/main/index.ts` owns startup, shutdown ordering, windows, and dependency
composition. Domain IPC is split under `src/main/ipc/`. OS and worker clients
live under `src/main/platform/`.

`RefCanvasDatabase` owns the SQLite connection and cross-repository
transactions. SQL is split by domain:

- `assets-repository.ts`: row mapping, search windows, relation hydration, and source lookup
- `boards-repository.ts`: board documents, summaries, and asset-reference index operations
- `collections-repository.ts`: folder trees, generated sources, ordering, and local locks
- `migration-repository.ts`: schema v1-v13 definitions, snapshots, logs, and migration runner
- `settings-repository.ts`: JSON settings and playback state

`LibraryService` remains the compatibility facade. Import job lifecycle,
metadata extraction, and watch ownership are implemented by
`ImportCoordinator`, `MetadataEnricher`, and `WatchReconcileService`.

## Renderer

`src/renderer/app/store.ts` composes four state slices:

- `features/library/library-query-slice.ts`
- `features/directory/directory-slice.ts`
- `features/board/board-slice.ts`
- `features/preferences/preferences-slice.ts`

The asset query cache keeps at most 12 pages of 200 records. Components live
under `src/renderer/components/`, outside the app composition root.

`BoardCanvas.tsx` is the only Fabric canvas lifecycle owner. Drawing, history,
selection, and viewport calculations are isolated under
`features/board/controllers/` and protected by characterization tests.

Renderer CSS has one ordered entry, `styles/index.css`, which imports shell,
directory, library, board, and dialog styles in cascade order.

## Gates

| Scope | Command | Blocking conditions |
| --- | --- | --- |
| Repository | `pnpm check:repo` | generated/runtime files, secrets, logs, or files over 10 MiB are candidates for Git |
| Lint | `pnpm lint` | `any`, `require`, or a layer-forbidden import (`no-restricted-imports` per `eslint.config.mjs`) |
| Development | `pnpm check` | repository, lint, type, architecture, unit, or integration failure |
| Release | `pnpm check:release` | development gate, performance, 500k capacity, package, or packaged runtime failure |
| Windows | `pnpm release:windows` | release gate, Squirrel/ZIP make, runtime migration, version, or SHA-256 verification failure |

`pnpm check` runs on every push and pull request to `main` via
`.github/workflows/check.yml`, so the development gate is enforced in CI rather
than by local convention. The workflow runs on `windows-latest` (the only
shipping target) and skips the Electron binary download, which no test needs.
ESLint (`eslint.config.mjs`) is the per-file companion to the module-graph
assertions in `tests/architecture/layers.test.ts`.

Runtime QA writes only to `%TEMP%\RefCanvas-QA\<run-id>`. Distributable files
are copied to `D:\AiWork\ref-canvas-releases\<version>`; Git stores only the
release notes and manifest.
