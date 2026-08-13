import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

interface ThumbnailIdentity {
  id: string;
  mtimeMs: number;
  size: number;
  fingerprint: string;
}

const safeId = (id: string): string => id.replaceAll(/[^a-zA-Z0-9_-]/g, "_");

export function thumbnailCacheFilename(
  asset: ThumbnailIdentity,
  variant = "composite",
): string {
  const identity = createHash("sha256")
    .update(`${asset.mtimeMs}:${asset.size}:${asset.fingerprint}`);
  if (variant !== "composite") identity.update(`:${variant}`);
  const signature = identity.digest("hex")
    .slice(0, 20);
  return `${safeId(asset.id)}-${signature}.png`;
}

export async function pruneStaleThumbnails(
  directory: string,
  assetId: string,
  keepFilename: string,
): Promise<void> {
  const prefix = `${safeId(assetId)}-`;
  const entries = await readdir(directory).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(prefix) && entry !== keepFilename)
      .map((entry) => rm(path.join(directory, entry), { force: true })),
  );
}
