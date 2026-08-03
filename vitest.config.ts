import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/{architecture,unit,integration}/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "node_modules.corrupt/**", "out/**"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
