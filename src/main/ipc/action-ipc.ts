import { z } from "zod";
import type { ActionService } from "../services/action-service";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import { selectionSchema } from "./schemas";

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

export function registerActionIpc(
  ipc: SecureIpcRegistrar,
  getActions: () => ActionService,
): void {
  ipc.handle("actions:start", async (request) => {
    const parsed = actionRequestSchema.parse(request);
    const options =
      parsed.type === "convert" || parsed.type === "webp"
        ? convertOptionsSchema.parse(parsed.options)
        : parsed.type === "merge-images"
          ? mergeOptionsSchema.parse(parsed.options)
          : parsed.type === "compress"
            ? compressOptionsSchema.parse(parsed.options)
            : parsed.type === "video-to-gif"
              ? videoToGifOptionsSchema.parse(parsed.options)
              : parsed.type === "change-extension"
                ? changeExtensionSchema.parse(parsed.options)
                : parsed.type === "export-csv"
                  ? exportCsvSchema.parse(parsed.options)
                  : parsed.options;
    return getActions().start({
      ...parsed,
      options,
      outputDirectory: parsed.outputDirectory ?? null,
      namingTemplate: parsed.namingTemplate ?? null,
    });
  });
  ipc.handle("actions:get", (id) =>
    getActions().get(z.string().min(1).max(64).parse(id)),
  );
  ipc.handle("actions:cancel", (id) =>
    getActions().cancel(z.string().min(1).max(64).parse(id)),
  );
  ipc.handle("actions:retry", (id) =>
    getActions().retry(z.string().min(1).max(64).parse(id)),
  );
  ipc.handle("actions:resolve-conflict", (id, outputPath, overwrite) =>
    getActions().resolveConflict(
      z.string().min(1).max(64).parse(id),
      z.string().min(1).max(32_768).parse(outputPath),
      z.boolean().parse(overwrite),
    ),
  );
}
