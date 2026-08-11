import type { AssetRecord } from "../../../shared/contracts";

export interface BoardFileImportGateway {
  pathsForFiles(files: File[]): string[];
  importPaths(paths: string[]): Promise<{ imported: number; reused: number }>;
  getByPath(path: string): Promise<AssetRecord | null>;
}

/** Coordinates file drops, asset placement, notices, and proxy refresh coalescing. */
export class BoardImportController {
  private proxyTimer: number | null = null;

  async importFiles(
    files: File[],
    position: { x: number; y: number },
    gateway: BoardFileImportGateway,
    placeAssets: (ids: string[], position: { x: number; y: number }) => Promise<number>,
    onLibraryChanged: () => Promise<void>,
  ): Promise<string | null> {
    const paths = gateway.pathsForFiles(files);
    if (!paths.length) return null;
    const result = await gateway.importPaths(paths);
    const imported = await Promise.all(paths.map((filename) => gateway.getByPath(filename)));
    const assets = imported.filter((item): item is AssetRecord => Boolean(item));
    if (assets.length) await placeAssets(assets.map((asset) => asset.id), position);
    await onLibraryChanged();
    const count = result.imported + result.reused;
    return assets.length
      ? `已加入 ${count} 项，并将 ${assets.length} 项放入白板`
      : "没有可放入白板的受支持文件";
  }

  scheduleProxyRefresh(refresh: () => void, delay = 180): void {
    if (this.proxyTimer !== null) window.clearTimeout(this.proxyTimer);
    this.proxyTimer = window.setTimeout(() => {
      this.proxyTimer = null;
      refresh();
    }, delay);
  }

  dispose(): void {
    if (this.proxyTimer !== null) window.clearTimeout(this.proxyTimer);
    this.proxyTimer = null;
  }
}
