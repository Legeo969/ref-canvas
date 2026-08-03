const { evaluate, waitFor } = require("../harness/cdp-client.cjs");

async function runPackagedSmoke(client) {
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await waitFor(
    client,
    `window.refCanvas && typeof window.refCanvas.filesystem?.listDirectory === "function"`,
    "RENDERER_API",
  );
  const result = await evaluate(
    client,
    `(async () => {
      await window.refCanvas.filesystem.setObservedDirectory("C:\\\\");
      const page = await window.refCanvas.filesystem.listDirectory("C:\\\\", {
        pageSize: 32,
      });
      await window.refCanvas.filesystem.setObservedDirectory(null);
      const app = await window.refCanvas.system.getAppInfo();
      return {
        appVersion: app.appVersion,
        databaseSchemaVersion: app.databaseSchemaVersion,
        rootEntries: page.entries.length,
        rootTotal: page.total,
      };
    })()`,
  );
  if (result.appVersion !== "0.37.1") {
    throw new Error(`APP_VERSION_MISMATCH:${result.appVersion}`);
  }
  if (result.databaseSchemaVersion !== 13) {
    throw new Error(`SCHEMA_VERSION_MISMATCH:${result.databaseSchemaVersion}`);
  }
  return result;
}

module.exports = { runPackagedSmoke };
