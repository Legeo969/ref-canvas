import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const packagedRuntimePaths = [
  "/.vite",
  "/package.json",
  "/THIRD_PARTY_NOTICES.md",
  "/assets",
  "/node_modules/better-sqlite3",
  "/node_modules/node-addon-api",
  "/node_modules/sharp",
  "/node_modules/@img",
  "/node_modules/detect-libc",
  "/node_modules/semver",
  "/node_modules/@img/sharp-win32-x64",
  "/node_modules/@img/sharp-libvips-win32-x64",
  "/node_modules/@ffprobe-installer",
];
const signingConfigured = Boolean(
  process.env.REFCANVAS_CERTIFICATE_FILE ||
    process.env.REFCANVAS_SIGN_WITH_PARAMS,
);

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpackDir:
        "node_modules/{@img/sharp-win32-x64,@ffprobe-installer/win32-x64}",
    },
    executableName: "RefCanvas",
    icon: "assets/installer/refcanvas.ico",
    ...(process.env.REFCANVAS_ELECTRON_ZIP_DIR
      ? { electronZipDir: process.env.REFCANVAS_ELECTRON_ZIP_DIR }
      : {}),
    download: {
      mirrorOptions: {
        mirror: "https://npmmirror.com/mirrors/electron/",
      },
    },
    ignore: (filePath) => {
      if (!filePath) {
        return false;
      }

      return !packagedRuntimePaths.some(
        (allowedPath) =>
          allowedPath.startsWith(filePath) || filePath.startsWith(allowedPath),
      );
    },
  },
  rebuildConfig: {
    onlyModules: ["better-sqlite3"],
  },
  makers: [
    new MakerSquirrel({
      name: "ref_canvas",
      setupExe: signingConfigured
        ? "RefCanvas-Setup.exe"
        : "RefCanvas-Setup-unsigned.exe",
      setupIcon: "assets/installer/refcanvas.ico",
      loadingGif: "assets/installer/loading.gif",
      ...(process.env.REFCANVAS_CERTIFICATE_FILE
        ? {
            certificateFile: process.env.REFCANVAS_CERTIFICATE_FILE,
            certificatePassword: process.env.REFCANVAS_CERTIFICATE_PASSWORD,
          }
        : process.env.REFCANVAS_SIGN_WITH_PARAMS
          ? { signWithParams: process.env.REFCANVAS_SIGN_WITH_PARAMS }
          : {}),
    }),
    new MakerZIP({}, ["win32"]),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: { main: "src/main/index.ts" },
          config: "vite.main.config.ts",
        },
        {
          entry: { preload: "src/preload/index.ts" },
          config: "vite.preload.config.ts",
          target: "preload",
        },
        {
          entry: { "thumbnail-worker": "src/workers/thumbnail.ts" },
          config: "vite.main.config.ts",
        },
        {
          entry: { "directory-index-worker": "src/workers/directory-index.ts" },
          config: "vite.main.config.ts",
        },
        {
          entry: { "import-enumerator": "src/workers/import-enumerator.ts" },
          config: "vite.main.config.ts",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
