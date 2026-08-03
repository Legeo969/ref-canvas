import { z } from "zod";

export const boardDocumentSchema = z.union([
  z.object({
    schemaVersion: z.literal(1),
    canvas: z.record(z.string(), z.unknown()),
  }),
  z.object({
    schemaVersion: z.literal(2),
    canvas: z.record(z.string(), z.unknown()),
    viewport: z.object({
      transform: z.tuple([
        z.number(),
        z.number(),
        z.number(),
        z.number(),
        z.number(),
        z.number(),
      ]),
      zoom: z.number().min(0.01).max(100),
    }),
    guides: z.object({
      x: z.array(z.number()).max(500),
      y: z.array(z.number()).max(500),
    }),
    appearance: z
      .object({
        backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
        gridVisible: z.boolean(),
        gridSize: z.number().int().min(8).max(96),
      })
      .optional(),
  }),
  z.object({
    schemaVersion: z.literal(3),
    canvas: z.record(z.string(), z.unknown()),
    viewport: z.object({
      transform: z.tuple([
        z.number(),
        z.number(),
        z.number(),
        z.number(),
        z.number(),
        z.number(),
      ]),
      zoom: z.number().min(0.01).max(100),
    }),
    guides: z.object({
      x: z.array(z.number()).max(500),
      y: z.array(z.number()).max(500),
    }),
    appearance: z
      .object({
        backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
        gridVisible: z.boolean(),
        gridSize: z.number().int().min(8).max(96),
      })
      .optional(),
    windowMode: z.enum([
      "normal",
      "always-on-bottom",
      "transparent-overlay",
      "locked",
    ]),
    canvasMode: z.object({
      locked: z.boolean(),
      grayscale: z.boolean(),
      gridStyle: z.enum(["line", "dot", "none"]),
    }),
    sampling: z.enum(["nearest", "bilinear"]),
    exportSettings: z.object({
      format: z.enum(["png", "jpeg", "webp"]),
      embedAssets: z.boolean(),
    }),
  }),
]);
