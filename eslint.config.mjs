import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Code-level companion to tests/architecture/layers.test.ts. The architecture
// test owns the module-graph invariants (via the TypeScript AST); ESLint adds
// the per-file constraints a graph check can't express — no `any`, no `require`,
// and layer-scoped import bans that fail fast in the editor before `pnpm check`.
const nativeModules = ["better-sqlite3", "sharp", "chokidar"];

function restrictedImports(paths, patterns) {
  return ["error", { paths, patterns }];
}

const nodeBuiltinPattern = {
  group: ["node:*"],
  message:
    "This layer is sandboxed. Reach platform capabilities through window.refCanvas.",
};

const nativePaths = nativeModules.map((name) => ({
  name,
  message: "Native addons are main-process only.",
}));

const ffprobePattern = {
  group: ["@ffprobe-installer/*"],
  message: "Native addons are main-process only.",
};

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      ".vite/",
      "out/",
      "dist/",
      "assets/",
      "coverage/",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // TypeScript resolves identifiers; core no-undef only false-positives on
      // type-space names and ambient globals here.
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-require-imports": "error",
      // Align ESLint's unused check with the tsc `_`-prefix convention already
      // in use (e.g. `_event` IPC listener params).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Renderer is the sandboxed, untrusted layer: no Electron, no native, no node.
    files: ["src/renderer/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrictedImports(
        [
          {
            name: "electron",
            message: "Renderer talks to the platform only via window.refCanvas.",
          },
          ...nativePaths,
        ],
        [nodeBuiltinPattern, ffprobePattern],
      ),
    },
  },
  {
    // Preload is the bridge: Electron is allowed, native/node are not.
    files: ["src/preload/**/*.ts"],
    rules: {
      "no-restricted-imports": restrictedImports(nativePaths, [
        nodeBuiltinPattern,
        ffprobePattern,
      ]),
    },
  },
  {
    // Shared contracts stay platform independent.
    files: ["src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": restrictedImports(
        [
          {
            name: "electron",
            message: "Shared contracts must not depend on Electron.",
          },
          ...nativePaths,
        ],
        [nodeBuiltinPattern, ffprobePattern],
      ),
    },
  },
);
