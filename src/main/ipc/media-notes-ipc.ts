import { z } from "zod";
import type { RefCanvasDatabase } from "../persistence/database";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import { idSchema } from "./schemas";

export function registerMediaNotesIpc(
  ipc: SecureIpcRegistrar,
  getDatabase: () => RefCanvasDatabase,
): void {
  ipc.handle("media-notes:list", (assetId) =>
    getDatabase().listMediaNotes(idSchema.parse(assetId)),
  );
  ipc.handle("media-notes:create", (assetId, input) =>
    getDatabase().createMediaNote(
      idSchema.parse(assetId),
      z
        .object({
          timeMs: z.number().int().min(0).max(315_360_000_000).optional(),
          positionKind: z.enum(["general", "time", "frame"]).optional(),
          position: z.number().int().min(0).max(315_360_000_000).optional(),
          text: z.string().trim().min(1).max(2_000),
        })
        .parse(input),
    ),
  );
  ipc.handle("media-notes:update", (id, patch) =>
    getDatabase().updateMediaNote(
      z.string().min(1).max(64).parse(id),
      z
        .object({
          timeMs: z.number().int().min(0).max(315_360_000_000).optional(),
          positionKind: z.enum(["general", "time", "frame"]).optional(),
          position: z.number().int().min(0).max(315_360_000_000).optional(),
          text: z.string().trim().min(1).max(2_000).optional(),
        })
        .parse(patch),
    ),
  );
  ipc.handle("media-notes:delete", (id) =>
    getDatabase().deleteMediaNote(z.string().min(1).max(64).parse(id)),
  );
  ipc.handle("media-notes:get-playback-state", (assetId) =>
    getDatabase().getPlaybackState(idSchema.parse(assetId)),
  );
  ipc.handle("media-notes:set-playback-state", (assetId, state) =>
    getDatabase().setPlaybackState(
      idSchema.parse(assetId),
      z
        .object({
          playbackRate: z.number().min(0.1).max(8).optional(),
          muted: z.boolean().optional(),
          volume: z.number().min(0).max(1).optional(),
          positionMs: z.number().min(0).optional(),
        })
        .parse(state),
    ),
  );
}
