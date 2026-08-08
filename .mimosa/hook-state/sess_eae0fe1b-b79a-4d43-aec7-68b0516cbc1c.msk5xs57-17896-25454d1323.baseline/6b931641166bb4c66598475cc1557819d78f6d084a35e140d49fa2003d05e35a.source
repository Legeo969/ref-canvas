export interface BoardHistoryEntry {
  index: number;
  snapshot: string;
}

export class BoardHistoryController {
  private snapshots: string[] = [];
  private currentIndex = -1;
  private undoLimit = 99;

  get index(): number {
    return this.currentIndex;
  }

  get canUndo(): boolean {
    return this.currentIndex > 0;
  }

  get canRedo(): boolean {
    return this.currentIndex < this.snapshots.length - 1;
  }

  setLimit(limit: number): void {
    this.undoLimit = Math.max(1, limit);
  }

  reset(snapshot: string): void {
    this.snapshots = [snapshot];
    this.currentIndex = 0;
  }

  push(snapshot: string): boolean {
    if (this.snapshots[this.currentIndex] === snapshot) return false;
    this.snapshots = this.snapshots.slice(
      Math.max(0, this.currentIndex - (this.undoLimit - 1)),
      this.currentIndex + 1,
    );
    this.snapshots.push(snapshot);
    this.currentIndex = this.snapshots.length - 1;
    return true;
  }

  entry(offset: -1 | 1): BoardHistoryEntry | null {
    const index = this.currentIndex + offset;
    const snapshot = this.snapshots[index];
    return snapshot === undefined ? null : { index, snapshot };
  }

  commit(index: number): void {
    if (index < 0 || index >= this.snapshots.length) return;
    this.currentIndex = index;
  }
}
