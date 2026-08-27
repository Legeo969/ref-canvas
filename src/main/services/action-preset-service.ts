import { randomUUID } from "node:crypto";
import type {
  ActionPreset,
  ActionPresetInput,
} from "../../shared/contracts";
import type { PairingSettingsStore } from "./browser-capture-pairing-service";

const SETTINGS_KEY = "actionPresets.v1";

export class ActionPresetService {
  constructor(private readonly getStore: () => PairingSettingsStore) {}

  list(): ActionPreset[] {
    const stored = this.getStore().getSetting<ActionPreset[]>(SETTINGS_KEY, []);
    return Array.isArray(stored) ? stored : [];
  }

  save(input: ActionPresetInput): ActionPreset {
    const now = new Date().toISOString();
    const preset: ActionPreset = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.write([...this.list(), preset]);
    return preset;
  }

  update(id: string, input: ActionPresetInput): ActionPreset {
    const current = this.list().find((preset) => preset.id === id);
    if (!current) throw new Error("ACTION_PRESET_NOT_FOUND");
    const updated = { ...current, ...input, updatedAt: new Date().toISOString() };
    this.write(this.list().map((preset) => preset.id === id ? updated : preset));
    return updated;
  }

  delete(id: string): void {
    this.write(this.list().filter((preset) => preset.id !== id));
  }

  get(id: string): ActionPreset {
    const preset = this.list().find((candidate) => candidate.id === id);
    if (!preset) throw new Error("ACTION_PRESET_NOT_FOUND");
    return preset;
  }

  private write(presets: ActionPreset[]): void {
    this.getStore().setSetting(SETTINGS_KEY, presets);
  }
}
