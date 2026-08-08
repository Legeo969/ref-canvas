import type Database from "better-sqlite3";
import type { PlaybackState } from "../../../shared/contracts";

export class SettingsRepository {
  constructor(private readonly db: Database.Database) {}

  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare(
      "SELECT value_json FROM settings WHERE key = ?",
    ).get(key) as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json) as T : fallback;
  }

  set(key: string, value: unknown): void {
    this.db.prepare(`
      INSERT INTO settings (key, value_json) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `).run(key, JSON.stringify(value));
  }

  getPlayback(assetId: string): PlaybackState | null {
    return this.get<PlaybackState | null>(`playback:${assetId}`, null);
  }

  setPlayback(
    assetId: string,
    state: Partial<PlaybackState>,
  ): PlaybackState {
    const current = this.getPlayback(assetId) ?? {
      playbackRate: 1,
      muted: false,
      volume: 1,
      positionMs: 0,
    };
    const next = { ...current, ...state };
    this.set(`playback:${assetId}`, next);
    return next;
  }
}
