export interface BoardSelectionSnapshot {
  count: number;
  activeObjectId: string | null;
}

const EMPTY_SELECTION: BoardSelectionSnapshot = Object.freeze({
  count: 0,
  activeObjectId: null,
});

/** External-store bridge: React observes IDs/counts, never Fabric objects. */
export class BoardSelectionSnapshotController {
  private snapshot: BoardSelectionSnapshot = EMPTY_SELECTION;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): BoardSelectionSnapshot => this.snapshot;

  update(count: number, activeObjectId: string | null): void {
    if (
      this.snapshot.count === count &&
      this.snapshot.activeObjectId === activeObjectId
    ) return;
    this.snapshot = Object.freeze({ count, activeObjectId });
    for (const listener of this.listeners) listener();
  }

  clear(): void {
    this.update(0, null);
  }
}
