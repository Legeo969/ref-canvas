import { z } from "zod";
import type { ActionService } from "../services/action-service";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import { selectionSchema } from "./schemas";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { assertAbsoluteLocalPath } from "../platform/local-path-security";
import type { WriteAccessController } from "../platform/write-access-controller";
import type { ActionPresetService } from "../services/action-preset-service";

const actionRequestSchema = z.object({
  type: z.enum([
    "convert",
    "merge-images",
    "webp",
    "compress",
    "video-to-gif",
    "change-extension",
    "export-csv",
    "export-folder",
  ]),
  targets: selectionSchema,
  options: z.record(z.string(), z.unknown()).default({}),
  outputDirectory: z.string().min(1).max(32_768).nullable().optional(),
  namingTemplate: z.string().max(256).nullable().optional(),
  keepHierarchy: z.boolean().optional(),
  writeSidecar: z.boolean().optional(),
});
const convertOptionsSchema = z.object({
  format: z.enum(["png", "jpeg", "webp", "avif", "tiff"]),
  quality: z.number().int().min(1).max(100).optional(),
  maxWidth: z.number().int().min(1).max(100_000).optional(),
  maxHeight: z.number().int().min(1).max(100_000).optional(),
});
const mergeOptionsSchema = z.object({
  direction: z.enum(["horizontal", "vertical", "grid"]),
  columns: z.number().int().min(1).max(10).optional(),
  gap: z.number().int().min(0).max(200).optional(),
});
const compressOptionsSchema = z.object({
  quality: z.number().int().min(1).max(100).optional(),
});
const videoToGifOptionsSchema = z.object({
  fps: z.number().int().min(1).max(60).optional(),
  scale: z.number().int().min(16).max(4096).optional(),
  startMs: z.number().min(0).nullable().optional(),
  endMs: z.number().min(0).nullable().optional(),
});
const changeExtensionSchema = z.object({
  extension: z.string().trim().regex(/^[a-z0-9]{1,16}$/i),
});
const exportCsvSchema = z.object({
  fields: z
    .array(
      z.enum([
        "title",
        "path",
        "extension",
        "size",
        "width",
        "height",
        "duration",
        "bpm",
        "rating",
        "tags",
        "notes",
        "createdAt",
        "updatedAt",
      ]),
    )
    .min(1)
    .max(20),
});
const noOptionsSchema = z.object({}).strict();

const actionPresetSchema = actionRequestSchema.omit({ targets: true }).extend({
  name: z.string().trim().min(1).max(120),
});

function parseOptions(type: z.infer<typeof actionRequestSchema>["type"], options: Record<string, unknown>) {
  return type === "convert" || type === "webp"
    ? convertOptionsSchema.parse(options)
    : type === "merge-images"
      ? mergeOptionsSchema.parse(options)
      : type === "compress"
        ? compressOptionsSchema.parse(options)
        : type === "video-to-gif"
          ? videoToGifOptionsSchema.parse(options)
          : type === "change-extension"
            ? changeExtensionSchema.parse(options)
            : type === "export-csv"
              ? exportCsvSchema.parse(options)
              : noOptionsSchema.parse(options);
}

export function registerActionIpc(
  ipc: SecureIpcRegistrar,
  dependencies: {
    getActions(): ActionService;
    getPresets(): ActionPresetService;
    windowForSender(event: IpcMainInvokeEvent): BrowserWindow;
    writeAccess: WriteAccessController;
  },
): void {
  const getActions = () => dependencies.getActions();
  const getPresets = () => dependencies.getPresets();
  const normalizedRequest = (request: unknown) => {
    const parsed = actionRequestSchema.parse(request);
    return {
      ...parsed,
      options: parseOptions(parsed.type, parsed.options),
      outputDirectory: parsed.outputDirectory ?? null,
      namingTemplate: parsed.namingTemplate ?? null,
    };
  };

  ipc.handle("actions:preview", (request) =>
    getActions().preview(normalizedRequest(request)),
  );
  ipc.handleWithEvent("actions:start", async (event, request) => {
    const next = normalizedRequest(request);
    const directory = next.outputDirectory
      ? assertAbsoluteLocalPath(next.outputDirectory)
      : getActions().authorizationDirectoryFor(next);
    const [authorizedDirectory] = await dependencies.writeAccess.authorize(
      dependencies.windowForSender(event), "export", [{ path: directory, mode: "destination" }],
    );
    return getActions().start({ ...next, outputDirectory: authorizedDirectory });
  });
  ipc.handle("actions:list-presets", () => getPresets().list());
  ipc.handle("actions:save-preset", (input) => {
    const parsed = actionPresetSchema.parse(input);
    return getPresets().save({
      ...parsed,
      options: parseOptions(parsed.type, parsed.options),
    });
  });
  ipc.handle("actions:update-preset", (id, input) => {
    const parsed = actionPresetSchema.parse(input);
    return getPresets().update(z.string().uuid().parse(id), {
      ...parsed,
      options: parseOptions(parsed.type, parsed.options),
    });
  });
  ipc.handle("actions:delete-preset", (id) =>
    getPresets().delete(z.string().uuid().parse(id)),
  );
  ipc.handleWithEvent("actions:run-preset", async (event, id, targets) => {
    const preset = getPresets().get(z.string().uuid().parse(id));
    const request = normalizedRequest({ ...preset, targets: selectionSchema.parse(targets) });
    const directory = request.outputDirectory
      ? assertAbsoluteLocalPath(request.outputDirectory)
      : getActions().authorizationDirectoryFor(request);
    const [authorizedDirectory] = await dependencies.writeAccess.authorize(
      dependencies.windowForSender(event),
      "export",
      [{ path: directory, mode: "destination" }],
    );
    return getActions().start({ ...request, outputDirectory: authorizedDirectory });
  });
  ipc.handle("actions:get", (id) =>
    getActions().get(z.string().min(1).max(64).parse(id)),
  );
  ipc.handle("actions:cancel", (id) =>
    getActions().cancel(z.string().min(1).max(64).parse(id)),
  );
  ipc.handleWithEvent("actions:retry", async (event, id) => {
    const parsedId = z.string().min(1).max(64).parse(id);
    const directory = getActions().authorizationDirectoryForRetry(parsedId);
    const [authorizedDirectory] = await dependencies.writeAccess.authorize(
      dependencies.windowForSender(event), "export", [{ path: directory, mode: "destination" }],
    );
    return getActions().retry(parsedId, authorizedDirectory);
  });
  ipc.handleWithEvent("actions:resolve-conflict", async (event, id, outputPath, overwrite) => {
    const parsedOutput = assertAbsoluteLocalPath(z.string().min(1).max(32_768).parse(outputPath));
    const [authorizedOutput] = await dependencies.writeAccess.authorize(
      dependencies.windowForSender(event), z.boolean().parse(overwrite) ? "trash" : "export", [
        { path: parsedOutput, mode: z.boolean().parse(overwrite) ? "existing" : "destination" },
      ],
    );
    return getActions().resolveConflict(
      z.string().min(1).max(64).parse(id), authorizedOutput, z.boolean().parse(overwrite),
    );
  });
}
