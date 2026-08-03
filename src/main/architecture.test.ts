import { builtinModules } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  hardenWindowNavigation,
  secureWebPreferences,
} from "./window-security";

const sourceRoot = path.resolve("src");
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
    const rendererFiles = [
      path.join(sourceRoot, "renderer.tsx"),
      ...productionFiles(await typeScriptFiles(path.join(sourceRoot, "app"))),
    ];
    const violations: string[] = [];

    for (const filename of rendererFiles) {
      for (const specifier of await imports(filename)) {
        const resolved = resolvedImport(filename, specifier);
        if (
          platformModules.has(specifier) ||
          (resolved &&
            (resolved === path.join(sourceRoot, "main") ||
              resolved === path.join(sourceRoot, "main.ts") ||
              isInside(resolved, path.join(sourceRoot, "main"))))
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
            (isInside(resolved, path.join(sourceRoot, "app")) ||
              isInside(resolved, path.join(sourceRoot, "main")) ||
              resolved === path.join(sourceRoot, "main.ts")))
        ) {
          violations.push(`${path.relative(sourceRoot, filename)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps main-process code independent from renderer implementation", async () => {
    const mainFiles = [
      path.join(sourceRoot, "main.ts"),
      ...productionFiles(await typeScriptFiles(path.join(sourceRoot, "main"))),
    ];
    const violations: string[] = [];

    for (const filename of mainFiles) {
      for (const specifier of await imports(filename)) {
        const resolved = resolvedImport(filename, specifier);
        if (
          resolved &&
          (isInside(resolved, path.join(sourceRoot, "app")) ||
            resolved === path.join(sourceRoot, "renderer"))
        ) {
          violations.push(`${path.relative(sourceRoot, filename)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("centralizes all IPC registration behind sender validation", async () => {
    const allowed = path.join(sourceRoot, "main", "secure-ipc.ts");
    const files = [
      path.join(sourceRoot, "main.ts"),
      ...(await typeScriptFiles(path.join(sourceRoot, "main"))),
    ];
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
      if (!importsNamedIdentifier(source, "../secure-ipc", "SecureIpcRegistrar")) {
        violations.push(path.relative(sourceRoot, filename));
      }
    }

    expect(files.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it("applies the shared security policy to every BrowserWindow", async () => {
    const source = await readFile(path.join(sourceRoot, "main.ts"), "utf8");
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
