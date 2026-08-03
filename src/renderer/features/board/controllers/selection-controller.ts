import type { AssetRecord } from "../../../../shared/contracts";

export function resolveBoardSelection(
  assets: AssetRecord[],
  target: { data?: { assetId?: string } } | null | undefined,
): { asset: AssetRecord | null; missingAssetId: string | null } {
  const assetId = target?.data?.assetId ?? null;
  if (!assetId) return { asset: null, missingAssetId: null };
  const asset = assets.find((item) => item.id === assetId) ?? null;
  return {
    asset,
    missingAssetId: asset ? null : assetId,
  };
}
