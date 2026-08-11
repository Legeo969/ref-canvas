import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  hardenWindowNavigation,
  secureWebPreferences,
} from "../../src/main/platform/window-security";

const sourceRoot = path.resolve("src");
const mainRoot = path.join(sourceRoot, "main");
const rendererRoot = path.join(sourceRoot, "renderer");
const preloadRoot = path.join(sourceRoot, "preload");
const sharedRoot = path.join(sourceRoot, "shared");

// Allowlists, not blocklists. A blocklist of native/node modules silently
// admits anything nobody remembered to add (e.g. a new `chokidar` import in the
// sandboxed renderer would run fine in tests and crash at runtime). Listing what
// each sandboxed layer MAY import inverts the failure: new dependencies are
// denied until someone consciously vouches for them here.
const rendererExternalAllowlist = new Set([
  "react",
  "react-dom",
  "three",
  "fabric",
  "zustand",
  "lucide-react",
  "zod",
]);
// The preload bridge runs with Node integration but is the security seam to the
// sandboxed renderer: it may only reach Electron. Native/node modules here would
// widen the bridge's attack surface for no reason.
const preloadExternalAllowlist = new Set(["electron"]);
// Shared contracts must stay platform independent: pure logic plus schema only.
const sharedExternalAllowlist = new Set(["zod"]);

/** Package root of a bare specifier: `three/examples/x` -> `three`, `@a/b/c` -> `@a/b`. */
function packageRoot(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
}

async function typeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) return typeScriptFiles(filename);
      return /\.tsx?$/.test(entry.name) ? [filename] : [];
    }),
  );
  return files.flat();
}

function productionFiles(files: string[]): string[] {
  return files.filter(
    (filename) =>
      !/\.(?:test|smoke)\.tsx?$/.test(filename),
  );
}

async function imports(filename: string): Promise<string[]> {
  const source = await readFile(filename, "utf8");
  return ts.preProcessFile(source, true, true).importedFiles.map(
    (entry) => entry.fileName,
  );
}

function resolvedImport(filename: string, specifier: string): string | null {
  return specifier.startsWith(".")
    ? path.resolve(path.dirname(filename), specifier)
    : null;
}

function isInside(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function importsNamedIdentifier(
  source: ts.SourceFile,
  moduleSpecifier: string,
  identifier: string,
): boolean {
  return source.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleSpecifier
    ) {
      return false;
    }
    const bindings = statement.importClause?.namedBindings;
    return (
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => element.name.text === identifier)
    );
  });
}

describe("architecture boundaries", () => {
  it("keeps renderer code behind the preload contract", async () => {
    const rendererFiles = productionFiles(await typeScriptFiles(rendererRoot));
    const violations: string[] = [];

    for (const filename of rendererFiles) {
      for (const specifier of await imports(filename)) {
        const resolved = resolvedImport(filename, specifier);
        if (resolved) {
          // Relative import: the only forbidden target is the main process.
          if (resolved === mainRoot || isInside(resolved, mainRoot)) {
            violations.push(`${path.relative(sourceRoot, filename)} -> ${specifier}`);
          }
        } else if (!rendererExternalAllowlist.has(packageRoot(specifier))) {
          // Bare specifier not on the allowlist — includes every node builtin,
          // native addon, and electron. Denied by default.
          violations.push(`${path.relative(sourceRoot, filename)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps shared contracts platform independent", async () => {
    const violations: string[] = [];

    for (const filename of productionFiles(await typeScriptFiles(sharedRoot))) {
      for (const specifier of await imports(filename)) {
        const resolved = resolvedImport(filename, specifier);
        if (resolved) {
          if (isInside(resolved, rendererRoot) || isInside(resolved, mainRoot)) {
            violations.push(`${path.relative(sourceRoot, filename)} -> ${specifier}`);
          }
        } else if (!sharedExternalAllowlist.has(packageRoot(specifier))) {
          violations.push(`${path.relative(sourceRoot, filename)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps main-process code independent from renderer implementation", async () => {
    const mainFiles = productionFiles(await typeScriptFiles(mainRoot));
    const violations: string[] = [];

    for (const filename of mainFiles) {
      for (const specifier of await imports(filename)) {
        const resolved = resolvedImport(filename, specifier);
        if (
          resolved &&
          isInside(resolved, rendererRoot)
        ) {
          violations.push(`${path.relative(sourceRoot, filename)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps the preload bridge within Electron and shared contracts", async () => {
    const preloadFiles = productionFiles(await typeScriptFiles(preloadRoot));
    const violations: string[] = [];

    expect(preloadFiles.length).toBeGreaterThan(0);
    for (const filename of preloadFiles) {
      for (const specifier of await imports(filename)) {
        const resolved = resolvedImport(filename, specifier);
        if (resolved) {
          // The bridge sits between main and renderer and must reach neither's
          // implementation — only the platform-independent shared contracts.
          if (isInside(resolved, mainRoot) || isInside(resolved, rendererRoot)) {
            violations.push(`${path.relative(sourceRoot, filename)} -> ${specifier}`);
          }
        } else if (!preloadExternalAllowlist.has(packageRoot(specifier))) {
          violations.push(`${path.relative(sourceRoot, filename)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("exposes exactly one frozen capability namespace over the context bridge", async () => {
    const entry = path.join(preloadRoot, "index.ts");
    const sourceText = await readFile(entry, "utf8");
    const source = ts.createSourceFile(
      entry,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
    );

    // The bridge is the whole point of contextIsolation: whatever crosses it is
    // reachable from untrusted renderer script. Assert the surface is a single
    // named, contract-typed object — never a raw Electron/Node handle, and never
    // more than one exposure that a later edit could sneak `ipcRenderer` into.
    const exposeCalls: ts.CallExpression[] = [];
    const forbiddenExposedValues = new Set([
      "ipcRenderer",
      "webUtils",
      "process",
      "require",
      "global",
      "electron",
    ]);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "contextBridge" &&
        node.expression.name.text === "exposeInMainWorld"
      ) {
        exposeCalls.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    expect(exposeCalls).toHaveLength(1);
    const [key, value] = exposeCalls[0].arguments;
    expect(ts.isStringLiteralLike(key) && key.text).toBe("refCanvas");
    // The exposed value must be a plain identifier (the assembled api object),
    // not an inline expression that could smuggle a raw handle across.
    expect(value && ts.isIdentifier(value)).toBe(true);
    if (value && ts.isIdentifier(value)) {
      expect(forbiddenExposedValues.has(value.text)).toBe(false);
    }
    // That identifier is bound to the shared contract type, tying the exposed
    // surface to `RefCanvasApi` so the typechecker guards every added method.
    expect(sourceText).toMatch(
      /const\s+api\s*:\s*RefCanvasApi\s*=/,
    );
    expect(importsNamedIdentifier(source, "../shared/contracts", "RefCanvasApi")).toBe(true);
  });

  it("centralizes all IPC registration behind sender validation", async () => {
    const allowed = path.join(mainRoot, "platform", "secure-ipc.ts");
    const files = await typeScriptFiles(mainRoot);
    const violations: string[] = [];

    for (const filename of files) {
      if (filename === allowed || filename.endsWith(".test.ts")) continue;
      const source = await readFile(filename, "utf8");
      if (/\bipcMain\b/.test(source)) {
        violations.push(path.relative(sourceRoot, filename));
      }
    }

    expect(violations).toEqual([]);
  });

  it("requires every domain IPC module to use SecureIpcRegistrar", async () => {
    const ipcRoot = path.join(sourceRoot, "main", "ipc");
    const files = (await typeScriptFiles(ipcRoot)).filter((filename) =>
      filename.endsWith("-ipc.ts"),
    );
    const violations: string[] = [];

    for (const filename of files) {
      const sourceText = await readFile(filename, "utf8");
      const source = ts.createSourceFile(
        filename,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
      );
      if (!importsNamedIdentifier(source, "../platform/secure-ipc", "SecureIpcRegistrar")) {
        violations.push(path.relative(sourceRoot, filename));
      }
    }

    expect(files.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it("applies the shared security policy to every BrowserWindow", async () => {
    // Scan every main file, not just index.ts. The invariant is "every window",
    // so a window constructed in any other main module must be covered too —
    // scoping the check to one file would let a second window-creating module
    // silently ship without the hardened policy.
    const mainFiles = productionFiles(await typeScriptFiles(mainRoot));
    let windowCount = 0;
    let policyCount = 0;
    const inlinePreferences: string[] = [];

    for (const filename of mainFiles) {
      const source = await readFile(filename, "utf8");
      windowCount += source.match(/new BrowserWindow\s*\(/g)?.length ?? 0;
      policyCount +=
        source.match(/webPreferences:\s*secureWebPreferences\s*\(/g)?.length ?? 0;
      if (/webPreferences:\s*{/.test(source)) {
        inlinePreferences.push(path.relative(sourceRoot, filename));
      }
    }

    expect(windowCount).toBeGreaterThan(0);
    expect(policyCount).toBe(windowCount);
    expect(inlinePreferences).toEqual([]);
  });
});

describe("window security policy", () => {
  it("uses the hardened Electron renderer defaults", () => {
    expect(secureWebPreferences("C:\\app\\preload.js")).toEqual({
      preload: "C:\\app\\preload.js",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });
  });

  it("denies new windows and cross-document navigation", () => {
    let openHandler: (() => { action: "deny" }) | undefined;
    let navigateHandler:
      | ((event: { preventDefault(): void }, targetUrl: string) => void)
      | undefined;
    const webContents = {
      getURL: () => "app://current",
      setWindowOpenHandler: (handler: typeof openHandler) => {
        openHandler = handler;
      },
      on: (
        event: string,
        handler: (event: { preventDefault(): void }, targetUrl: string) => void,
      ) => {
        if (event === "will-navigate") navigateHandler = handler;
        return webContents;
      },
    };
    const preventDefault = vi.fn();

    hardenWindowNavigation(webContents as never);

    expect(openHandler?.()).toEqual({ action: "deny" });
    navigateHandler?.({ preventDefault }, "https://example.com");
    expect(preventDefault).toHaveBeenCalledOnce();
    preventDefault.mockClear();
    navigateHandler?.({ preventDefault }, "app://current");
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe("physical module boundaries", () => {
  it("keeps persistence domains behind the database facade", async () => {
    const facadePath = path.join(mainRoot, "persistence", "database.ts");
    const sourceText = await readFile(facadePath, "utf8");
    const source = ts.createSourceFile(
      facadePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
    );
    const repositories = [
      ["assets-repository", "AssetsRepository"],
      ["boards-repository", "BoardsRepository"],
      ["migration-repository", "MigrationRepository"],
      ["settings-repository", "SettingsRepository"],
    ] as const;

    for (const [moduleName, identifier] of repositories) {
      await readFile(
        path.join(mainRoot, "persistence", "repositories", `${moduleName}.ts`),
        "utf8",
      );
      expect(
        importsNamedIdentifier(
          source,
          `./repositories/${moduleName}`,
          identifier,
        ),
      ).toBe(true);
    }
  });

  it("keeps library orchestration behind focused services", async () => {
    const facadePath = path.join(mainRoot, "services", "library-service.ts");
    const sourceText = await readFile(facadePath, "utf8");
    const source = ts.createSourceFile(
      facadePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
    );
    const services = [
      ["import-coordinator", "ImportCoordinator"],
      ["metadata-enricher", "MetadataEnricher"],
      ["watch-reconcile-service", "WatchReconcileService"],
    ] as const;

    for (const [moduleName, identifier] of services) {
      await readFile(
        path.join(mainRoot, "services", `${moduleName}.ts`),
        "utf8",
      );
      expect(
        importsNamedIdentifier(source, `./${moduleName}`, identifier),
      ).toBe(true);
    }
  });

  it("composes renderer state from bounded domain slices", async () => {
    const store = await readFile(path.join(rendererRoot, "app", "store.ts"), "utf8");
    expect(store).toContain('from "../features/library/query-window"');
    const slices = [
      ["library", "library-query-slice"],
      ["directory", "directory-slice"],
      ["board", "board-slice"],
      ["preferences", "preferences-slice"],
    ] as const;
    await readFile(
      path.join(rendererRoot, "features", "library", "query-window.ts"),
      "utf8",
    );
    for (const [domain, moduleName] of slices) {
      await readFile(
        path.join(rendererRoot, "features", domain, `${moduleName}.ts`),
        "utf8",
      );
      expect(store).toContain(`from "../features/${domain}/${moduleName}"`);
    }
  });

  it("keeps components and board controllers outside the app composition root", async () => {
    const componentsRoot = path.join(rendererRoot, "components");
    const boardCanvas = await readFile(
      path.join(componentsRoot, "BoardCanvas.tsx"),
      "utf8",
    );
    await expect(
      stat(path.join(rendererRoot, "app", "components")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    for (const controller of ["drawing", "history", "selection", "viewport"]) {
      await readFile(
        path.join(
          rendererRoot,
          "features",
          "board",
          "controllers",
          `${controller}-controller.ts`,
        ),
        "utf8",
      );
      expect(boardCanvas).toContain(
        `../features/board/controllers/${controller}-controller`,
      );
    }
  });

  it("keeps renderer styles split behind one ordered entry", async () => {
    const entry = await readFile(
      path.join(rendererRoot, "styles", "index.css"),
      "utf8",
    );
    expect(entry.trim().split(/\r?\n/)).toEqual([
      '@import "./shell.css";',
      '@import "./select-menu.css";',
      '@import "./directory.css";',
      '@import "./library.css";',
      '@import "./board.css";',
      '@import "./dialogs.css";',
      '@import "./collections.css";',
      '@import "./ai.css";',
      '@import "./image-review.css";',
      '@import "./found-preview.css";',
    ]);
    await Promise.all(
      ["shell", "select-menu", "directory", "library", "board", "dialogs", "collections", "ai", "image-review", "found-preview"].map((name) =>
        readFile(path.join(rendererRoot, "styles", `${name}.css`), "utf8"),
      ),
    );
  });

  it("keeps board React integration behind controllers and lightweight snapshots", async () => {
    const boardCanvas = await readFile(
      path.join(rendererRoot, "components", "BoardCanvas.tsx"),
      "utf8",
    );
    for (const moduleName of [
      "board-runtime-controller",
      "board-canvas-controller",
      "board-persistence-controller",
      "board-import-controller",
      "use-board-bindings",
      "use-board-gesture-keys",
      "use-board-shortcuts",
    ]) {
      await readFile(
        path.join(rendererRoot, "features", "board", `${moduleName}.ts`),
        "utf8",
      );
      expect(boardCanvas).toContain(`../features/board/${moduleName}`);
    }
    for (const removedMirror of [
      "assetsRef",
      "onSaveRef",
      "documentRef",
      "appearanceRef",
      "canvasModeRef",
      "samplingRef",
    ]) {
      expect(boardCanvas).not.toContain(removedMirror);
    }
    expect(boardCanvas.split(/\r?\n/).length).toBeLessThan(6_500);

    const controller = await readFile(
      path.join(rendererRoot, "features", "board", "board-canvas-controller.ts"),
      "utf8",
    );
    expect(controller).toContain("syncDocument(boardId");
    expect(controller).toContain("canvas.on(");
    expect(controller).toContain("canvas.off(");
    expect(controller).toContain("command(command: BoardControllerCommand, id: string)");
    expect(controller).not.toMatch(/selectionIds:\s*(?:Fabric|CanvasObject)/);

    for (const component of [
      "BoardToolbar.tsx",
      "BoardLayerPanel.tsx",
      "BoardFocusOverlay.tsx",
    ]) {
      const presentation = await readFile(
        path.join(rendererRoot, "components", "board", component),
        "utf8",
      );
      expect(presentation).not.toMatch(/from ["']fabric["']/);
      expect(presentation).not.toContain("getObjects(");
      expect(presentation).not.toContain("getActiveObjects(");
      expect(boardCanvas).toContain(`./board/${component.replace(".tsx", "")}`);
    }
    const inspector = await readFile(
      path.join(rendererRoot, "components", "BoardInspector.tsx"),
      "utf8",
    );
    expect(inspector).not.toMatch(/from ["']fabric["']/);

    const sourceFile = ts.createSourceFile(
      "BoardCanvas.tsx",
      boardCanvas,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let boardFunction: ts.FunctionLikeDeclaration | undefined;
    sourceFile.forEachChild((node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "BoardCanvas") {
        boardFunction = node;
      }
    });
    expect(boardFunction).toBeDefined();
    const forbiddenFabricState: string[] = [];
    const renderReads: string[] = [];
    const visit = (node: ts.Node, insideCallback = false) => {
      if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === "useState") {
        const stateType = node.typeArguments?.map((argument) => argument.getText(sourceFile)).join(" ") ?? "";
        if (/(?:Fabric|CanvasObject)/.test(stateType)) forbiddenFabricState.push(stateType);
      }
      if (!insideCallback && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        if (["getObjects", "getActiveObjects", "getActiveObject"].includes(node.expression.name.text)) {
          renderReads.push(node.expression.getText(sourceFile));
        }
      }
      const callback = insideCallback || (node !== boardFunction && ts.isFunctionLike(node));
      ts.forEachChild(node, (child) => visit(child, callback));
    };
    visit(boardFunction!);
    expect(forbiddenFabricState).toEqual([]);
    // Callback-time Fabric reads are allowed; render-time derived arrays are not.
    expect(renderReads).toEqual([]);
  });

  it("keeps directory orchestration behind behavior-owning domain models", async () => {
    const panel = await readFile(
      path.join(rendererRoot, "components", "DirectoryAssetPanel.tsx"),
      "utf8",
    );
    for (const moduleName of [
      "directory-virtual-grid",
      "use-directory-selection",
      "directory-preview-coordinator",
      "directory-query-model",
    ]) {
      const module = await readFile(
        path.join(rendererRoot, "features", "directory", `${moduleName}.ts`),
        "utf8",
      );
      expect(panel).toContain(`../features/directory/${moduleName}`);
      expect(module).toMatch(/export function/);
    }
    // 选择行为保留在 domain model 中；panel 经由 hook 编排，不直接持有逻辑。
    const selectionHook = await readFile(
      path.join(rendererRoot, "features", "directory", "use-directory-selection.ts"),
      "utf8",
    );
    const selectionModel = await readFile(
      path.join(rendererRoot, "features", "directory", "directory-selection-model.ts"),
      "utf8",
    );
    expect(selectionHook).toContain("./directory-selection-model");
    expect(selectionModel).toMatch(/export function/);
    const toolbar = await readFile(
      path.join(rendererRoot, "components", "directory", "DirectoryBatchToolbar.tsx"),
      "utf8",
    );
    expect(panel).toContain('./directory/DirectoryBatchToolbar');
    expect(toolbar).toContain("selectedCount");
  });

  it("splits settings, store, library, and i18n behind compatible facades", async () => {
    const settings = await readFile(
      path.join(rendererRoot, "components", "SettingsPanel.tsx"),
      "utf8",
    );
    expect(settings).toContain('./settings/AboutSettings');
    expect(settings).toContain('./settings/MaintenanceSettings');

    const store = await readFile(path.join(rendererRoot, "app", "store.ts"), "utf8");
    expect(store).toContain('../features/library/selection-model');
    expect(store).toContain('../features/library/import-job-model');
    expect(store).toContain('../features/board/board-state-model');

    const library = await readFile(
      path.join(mainRoot, "services", "library-service.ts"),
      "utf8",
    );
    expect(library).toContain('./visual-signature-service');
    expect(library).toContain('export { imageVisualSignature, visualSimilarity }');

    const i18n = await readFile(path.join(rendererRoot, "app", "i18n.ts"), "utf8");
    expect(i18n.split(/\r?\n/).length).toBeLessThan(600);
    for (const fragment of [
      "shell",
      "directory",
      "board",
      "collections",
      "preview-media",
      "ai",
      "settings",
      "common",
    ]) {
      const catalog = await readFile(
        path.join(rendererRoot, "app", "i18n-catalogs", `${fragment}.ts`),
        "utf8",
      );
      expect(catalog).toContain("satisfies Record<string, Partial<Record<MessageKey, string>>>");
    }
  });
});
