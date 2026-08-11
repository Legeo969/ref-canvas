import type { AssetRecord, DirectoryEntry } from "../../../shared/contracts";

export interface DirectoryPreviewSnapshot {
  path: string | null;
  entry: DirectoryEntry | null;
  asset: AssetRecord | null;
  loading: boolean;
}

const EMPTY_PREVIEW: DirectoryPreviewSnapshot = Object.freeze({
  path: null,
  entry: null,
  asset: null,
  loading: false,
});

export class DirectoryPreviewCoordinator {
  private entries: readonly DirectoryEntry[] = [];
  private snapshot = EMPTY_PREVIEW;
  private readonly listeners = new Set<() => void>();
  private generation = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DirectoryPreviewSnapshot => this.snapshot;

  syncEntries(entries: readonly DirectoryEntry[]): void {
    this.entries = entries;
    if (!this.snapshot.path) return;
    const entry = resolveDirectoryPreview(entries, this.snapshot.path);
    if (!entry) this.close();
    else if (entry !== this.snapshot.entry) this.publish({ ...this.snapshot, entry });
  }

  open(entry: DirectoryEntry): void {
    if (entry.isDirectory) return;
    this.generation += 1;
    this.publish({ path: entry.path, entry, asset: null, loading: false });
  }

  close(): void {
    this.generation += 1;
    this.publish(EMPTY_PREVIEW);
  }

  adjacent(delta: number): DirectoryEntry | null {
    const path = adjacentDirectoryPreviewPath(this.entries, this.snapshot.path, delta);
    const entry = resolveDirectoryPreview(this.entries, path);
    if (entry) this.open(entry);
    return entry;
  }

  async materialize(getByPath: (path: string) => Promise<AssetRecord | null>): Promise<AssetRecord | null> {
    const path = this.snapshot.path;
    if (!path) return null;
    const generation = ++this.generation;
    this.publish({ ...this.snapshot, loading: true });
    const asset = await getByPath(path);
    if (generation !== this.generation || this.snapshot.path !== path) return null;
    this.publish({ ...this.snapshot, asset, loading: false });
    return asset;
  }

  dispose(): void {
    this.generation += 1;
    this.listeners.clear();
    this.snapshot = EMPTY_PREVIEW;
  }

  private publish(snapshot: DirectoryPreviewSnapshot): void {
    this.snapshot = Object.freeze(snapshot);
    for (const listener of this.listeners) listener();
  }
}

export function resolveDirectoryPreview(
  entries: readonly DirectoryEntry[],
  previewPath: string | null,
): DirectoryEntry | null {
  if (!previewPath) return null;
  return entries.find((entry) => entry.path === previewPath && !entry.isDirectory) ?? null;
}

export function adjacentDirectoryPreviewPath(
  entries: readonly DirectoryEntry[],
  previewPath: string | null,
  delta: number,
): string | null {
  if (!previewPath) return null;
  const files = entries.filter((entry) => !entry.isDirectory);
  const index = files.findIndex((entry) => entry.path === previewPath);
  if (index < 0 || files.length === 0) return null;
  return files[(index + delta + files.length) % files.length]?.path ?? null;
}
