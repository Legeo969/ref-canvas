import type { AssetKind } from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";

interface ExtractedMetadata {
  width: number | null;
  height: number | null;
  duration: number | null;
  bpm: number | null;
}

export interface MetadataEnrichmentDelta {
  enriched: number;
  failed: number;
}

export class MetadataEnricher {
  constructor(
    private readonly database: RefCanvasDatabase,
    private readonly extract: (
      filename: string,
      kind: AssetKind,
      signal: AbortSignal,
    ) => Promise<ExtractedMetadata>,
  ) {}

  async run(
    jobId: string | undefined,
    signal: AbortSignal,
    onProgress?: (delta: MetadataEnrichmentDelta) => void,
  ): Promise<void> {
    while (!signal.aborted) {
      const pending = this.database.listPendingAssetMetadata(256, jobId);
      if (!pending.length) return;
      for (let offset = 0; offset < pending.length; offset += 12) {
        if (signal.aborted) return;
        const batch = pending.slice(offset, offset + 12);
        let enriched = 0;
        let failed = 0;
        await Promise.all(batch.map(async (asset) => {
          try {
            const metadata = await this.extract(asset.path, asset.kind, signal);
            if (signal.aborted) return;
            this.database.updateAssetMetadata(asset.id, {
              ...metadata,
              status: "ready",
            });
            enriched += 1;
          } catch (error) {
            if (signal.aborted) return;
            this.database.updateAssetMetadata(asset.id, {
              width: null,
              height: null,
              duration: null,
              bpm: null,
              status: "failed",
              error: error instanceof Error ? error.message : "METADATA_FAILED",
            });
            failed += 1;
          }
        }));
        if (enriched || failed) onProgress?.({ enriched, failed });
      }
    }
  }
}
