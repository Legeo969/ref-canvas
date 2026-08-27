import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  CapturePairingCode,
  CapturePairingRecord,
} from "../../shared/contracts";

const SETTINGS_KEY = "browserCapturePairings.v1";
const PAIRING_TTL_MS = 60_000;
const MAX_PAIRING_ATTEMPTS = 5;

interface StoredCapturePairing extends CapturePairingRecord {
  tokenHash: string;
}

interface PairingWindow {
  codeHash: string;
  expiresAtMs: number;
  attemptsRemaining: number;
}

export interface PairingSettingsStore {
  getSetting<T>(key: string, fallback: T): T;
  setSetting(key: string, value: unknown): void;
}

export interface CapturePairingResult {
  token: string;
  pairing: CapturePairingRecord;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function publicRecord(record: StoredCapturePairing): CapturePairingRecord {
  const { tokenHash: _tokenHash, ...pairing } = record;
  return pairing;
}

export function isBrowserExtensionOrigin(origin: string): boolean {
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}

export class BrowserCapturePairingService {
  private pairingWindow: PairingWindow | null = null;

  constructor(
    private readonly getStore: () => PairingSettingsStore,
    private readonly now: () => number = Date.now,
  ) {}

  createPairingCode(): CapturePairingCode {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAtMs = this.now() + PAIRING_TTL_MS;
    this.pairingWindow = {
      codeHash: hash(code),
      expiresAtMs,
      attemptsRemaining: MAX_PAIRING_ATTEMPTS,
    };
    return { code, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  pair(code: string, origin: string, label?: string): CapturePairingResult {
    if (!isBrowserExtensionOrigin(origin)) throw new Error("PAIRING_ORIGIN_REJECTED");
    const window = this.pairingWindow;
    if (!window || window.expiresAtMs <= this.now()) {
      this.pairingWindow = null;
      throw new Error("PAIRING_CODE_EXPIRED");
    }
    window.attemptsRemaining -= 1;
    if (!/^\d{6}$/.test(code) || !hashesMatch(window.codeHash, hash(code))) {
      if (window.attemptsRemaining <= 0) this.pairingWindow = null;
      throw new Error("PAIRING_CODE_INVALID");
    }

    this.pairingWindow = null;
    const token = randomBytes(32).toString("base64url");
    const createdAt = new Date(this.now()).toISOString();
    const record: StoredCapturePairing = {
      id: randomUUID(),
      origin,
      label: label?.trim().slice(0, 80) || "Chrome / Edge",
      createdAt,
      lastUsedAt: null,
      tokenHash: hash(token),
    };
    const records = this.readStored().filter((item) => item.origin !== origin);
    records.push(record);
    this.writeStored(records);
    return { token, pairing: publicRecord(record) };
  }

  authenticate(origin: string, token: string): CapturePairingRecord | null {
    if (!isBrowserExtensionOrigin(origin) || !token) return null;
    const records = this.readStored();
    const tokenHash = hash(token);
    const index = records.findIndex(
      (record) => record.origin === origin && hashesMatch(record.tokenHash, tokenHash),
    );
    if (index < 0) return null;
    const lastUsedAt = new Date(this.now()).toISOString();
    const previousUse = records[index].lastUsedAt
      ? Date.parse(records[index].lastUsedAt)
      : 0;
    if (this.now() - previousUse >= 60_000) {
      records[index] = { ...records[index], lastUsedAt };
      this.writeStored(records);
    }
    return publicRecord(records[index]);
  }

  listPairings(): CapturePairingRecord[] {
    return this.readStored()
      .map(publicRecord)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  revokePairing(id: string): void {
    this.writeStored(this.readStored().filter((record) => record.id !== id));
  }

  private readStored(): StoredCapturePairing[] {
    const stored = this.getStore().getSetting<StoredCapturePairing[]>(SETTINGS_KEY, []);
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (record) =>
        record &&
        typeof record.id === "string" &&
        typeof record.origin === "string" &&
        typeof record.tokenHash === "string",
    );
  }

  private writeStored(records: StoredCapturePairing[]): void {
    this.getStore().setSetting(SETTINGS_KEY, records);
  }
}
