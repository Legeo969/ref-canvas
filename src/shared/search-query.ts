import type {
  AssetKind,
  AssetSearchInput,
  ParsedAssetSearch,
} from "./contracts";

const KINDS = new Set<AssetKind>([
  "image", "video", "audio", "pdf", "model3d", "dcc", "font", "generic",
]);

function bytes(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/i.exec(value);
  if (!match) return undefined;
  const multiplier = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[
    (match[2] ?? "b").toLowerCase() as "b" | "kb" | "mb" | "gb"
  ];
  return Math.round(Number(match[1]) * multiplier);
}

function comparison(value: string): { operator: ">=" | "<=" | "="; value: string } {
  const match = /^(>=|<=|=)?(.+)$/.exec(value)!;
  return { operator: (match[1] as ">=" | "<=" | "=" | undefined) ?? "=", value: match[2] };
}

export function parseAssetSearchQuery(source: string): ParsedAssetSearch {
  const input: AssetSearchInput = {};
  const terms: string[] = [];
  const unsupported: string[] = [];
  const includeTags: string[] = [];
  for (const token of source.match(/[^\s"]+:"[^"]*"|"[^"]+"|\S+/g) ?? []) {
    const normalized = token.replace(/^"|"$/g, "");
    if (normalized.startsWith("#") && normalized.length > 1) {
      includeTags.push(normalized.slice(1));
      continue;
    }
    const separator = normalized.indexOf(":");
    if (separator < 1) {
      terms.push(normalized);
      continue;
    }
    const key = normalized.slice(0, separator).toLowerCase();
    const rawValue = normalized.slice(separator + 1).replace(/^"|"$/g, "");
    const condition = comparison(rawValue);
    if (key === "type" && KINDS.has(condition.value as AssetKind)) {
      input.kind = condition.value as AssetKind;
    } else if (key === "ext" || key === "extension") {
      input.extension = condition.value.replace(/^\./, "").toLowerCase();
    } else if (key === "path") {
      input.pathContains = condition.value;
    } else if (key === "rating" && /^\d$/.test(condition.value)) {
      input.ratingMin = Number(condition.value);
    } else if (key === "width" || key === "height") {
      const dimension = Number(condition.value);
      if (!Number.isFinite(dimension)) unsupported.push(token);
      else if (key === "width") {
        if (condition.operator === "<=") input.maxWidth = dimension;
        else input.minWidth = dimension;
      } else if (condition.operator === "<=") input.maxHeight = dimension;
      else input.minHeight = dimension;
    } else if (key === "size") {
      const size = bytes(condition.value);
      if (size === undefined) unsupported.push(token);
      else if (condition.operator === "<=") input.maxSize = size;
      else input.minSize = size;
    } else if ((key === "after" || key === "before") && !Number.isNaN(Date.parse(condition.value))) {
      if (key === "after") input.modifiedAfter = condition.value;
      else input.modifiedBefore = condition.value;
    } else {
      unsupported.push(token);
    }
  }
  if (terms.length) input.query = terms.join(" ");
  if (includeTags.length === 1) input.tag = includeTags[0];
  if (includeTags.length > 1) input.includeTags = includeTags;
  return { source, input, unsupported };
}
