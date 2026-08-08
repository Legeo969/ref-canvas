import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";

it("does not schedule automatic backups", async () => {
  const main = await readFile(path.resolve("src/main/index.ts"), "utf8");
  const service = await readFile(
    path.resolve("src/main/services/backup-service.ts"),
    "utf8",
  );
  expect(main).not.toContain("createDailyIfNeeded");
  expect(service).not.toContain("refcanvas-auto-${");
});
