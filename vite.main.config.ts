import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      external: [
        "better-sqlite3",
        "sharp",
        "exrs",
        "@ffprobe-installer/ffprobe",
        "ffmpeg-static",
        // 原生抓屏绑定（napi-rs）：.node 二进制不能被 Rollup 打包，
        // 且打包进 asar 后必须保持 external 才能在 unpacked 目录被 require。
        "node-screenshots",
        // Emscripten 产物：.wasm 靠 __dirname 相对定位，被 Rollup 收进
        // bundle 后路径会失效。保持 external，让运行时从 node_modules 加载。
        "node-unrar-js",
        "7z-wasm",
      ],
    },
  },
});
