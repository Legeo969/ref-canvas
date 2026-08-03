import { builtinModules } from "node:module";
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
const platformModules = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  "@ffprobe-installer/ffprobe",
  "better-sqlite3",
  "electron",
  "sharp",
]);

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
        if (
          platformModules.has(specifier) ||
          (resolved &&
            (resolved === mainRoot || isInside(resolved, mainRoot)))
        ) {
          violations.push(`${path.relative(sourceRoot, filename)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps shared contracts platform independent", async () => {
    const sharedRoot = path.join(sourceRoot, "shared");
    const violations: string[] = [];

    for (const filename of await typeScriptFiles(sharedRoot)) {
      for (const specifier of await imports(filename)) {
        const resolved = resolvedImport(filename, specifier);
        if (
          platformModules.has(specifier) ||
          (resolved &&
            (isInside(resolved, rendererRoot) || isInside(resolved, mainRoot)))
        ) {
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
    const source = await readFile(path.join(mainRoot, "index.ts"), "utf8");
    const windowCount = source.match(/new BrowserWindow\s*\(/g)?.length ?? 0;
    const policyCount = source.match(/webPreferences:\s*secureWebPreferences\s*\(/g)?.length ?? 0;

    expect(windowCount).toBeGreaterThan(0);
    expect(policyCount).toBe(windowCount);
    expect(source).not.toMatch(/webPreferences:\s*{/);
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
      ["collections-repository", "CollectionsRepository"],
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
      '@import "./directory.css";',
      '@import "./library.css";',
      '@import "./board.css";',
      '@import "./dialogs.css";',
    ]);
    await Promise.all(
      ["shell", "directory", "library", "board", "dialogs"].map((name) =>
        readFile(path.join(rendererRoot, "styles", `${name}.css`), "utf8"),
      ),
    );
  });
});
