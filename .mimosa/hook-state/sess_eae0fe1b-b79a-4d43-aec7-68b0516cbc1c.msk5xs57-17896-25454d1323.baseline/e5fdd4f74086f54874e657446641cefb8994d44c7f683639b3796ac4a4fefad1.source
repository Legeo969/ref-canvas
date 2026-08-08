import type { AssetRecord } from "../../../shared/contracts";

export const ASSET_PAGE_SIZE = 200;
export const MAX_RESIDENT_ASSET_PAGES = 12;

export interface AssetWindowState {
  assets: AssetRecord[];
  assetWindowOffset: number;
}

export class AssetQueryWindow {
  private readonly pages = new Map<number, AssetRecord[]>();

  clear(): void {
    this.pages.clear();
  }

  has(pageIndex: number): boolean {
    return this.pages.has(pageIndex);
  }

  set(pageIndex: number, items: AssetRecord[]): AssetWindowState {
    const existing = [...this.pages.keys()].sort((left, right) => left - right);
    if (
      existing.length &&
      (pageIndex < existing[0] - 1 || pageIndex > existing.at(-1)! + 1)
    ) {
      this.pages.clear();
    }
    this.pages.set(pageIndex, items);
    while (this.pages.size > MAX_RESIDENT_ASSET_PAGES) {
      const pages = [...this.pages.keys()].sort((left, right) => left - right);
      const first = pages[0];
      const last = pages.at(-1)!;
      this.pages.delete(
        Math.abs(pageIndex - first) > Math.abs(last - pageIndex) ? first : last,
      );
    }
    return this.snapshot();
  }

  replace(updated: AssetRecord): void {
    for (const [page, assets] of this.pages) {
      const index = assets.findIndex((asset) => asset.id === updated.id);
      if (index < 0) continue;
      const next = [...assets];
      next[index] = updated;
      this.pages.set(page, next);
      return;
    }
  }

  private snapshot(): AssetWindowState {
    const pages = [...this.pages.keys()].sort((left, right) => left - right);
    return {
      assetWindowOffset: (pages[0] ?? 0) * ASSET_PAGE_SIZE,
      assets: pages.flatMap((page) => this.pages.get(page) ?? []),
    };
  }
}
