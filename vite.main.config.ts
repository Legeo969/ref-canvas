import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      external: [
        "better-sqlite3",
        "sharp",
        "@ffprobe-installer/ffprobe",
      ],
    },
  },
});
