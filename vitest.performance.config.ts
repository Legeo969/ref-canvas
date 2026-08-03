import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/main/performance.smoke.ts"],
    testTimeout: 180_000,
  },
});
