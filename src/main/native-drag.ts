import { existsSync } from "node:fs";
import path from "node:path";
import type { AssetRecord } from "../shared/contracts";

export function resolveNativeDragAssets(
  assetIds: string[],
  getAsset: (id: string) => AssetRecord | null,
  fileExists: (filename: string) => boolean = existsSync,
): AssetRecord[] {
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const result: AssetRecord[] = [];

  for (const id of assetIds) {
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const asset = getAsset(id);
    if (
      !asset ||
      asset.lifecycle !== "active" ||
      asset.linkState !== "online" ||
      !path.isAbsolute(asset.path) ||
      !fileExists(asset.path)
    ) {
      continue;
    }
    const pathKey = path.normalize(asset.path).toLocaleLowerCase();
    if (seenPaths.has(pathKey)) continue;
    seenPaths.add(pathKey);
    result.push(asset);
  }

  return result;
}
