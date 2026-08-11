export interface AssetContentIdentity {
  size: number;
  fingerprint: string | null | undefined;
}

/**
 * Visual indexes describe file contents, not metadata or location. A missing
 * fingerprint is stable only when it is missing on both sides; size remains
 * part of the identity so legacy rows cannot retain an index after replacement.
 */
export function hasSameAssetContentIdentity(
  current: AssetContentIdentity,
  next: AssetContentIdentity,
): boolean {
  return current.size === next.size && current.fingerprint === next.fingerprint;
}
