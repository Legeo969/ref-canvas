export interface CommandSearchItem {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  keywords?: string[];
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

export function rankCommandItems<T extends CommandSearchItem>(
  items: T[],
  query: string,
  recentIds: string[] = [],
): T[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    const recentRank = new Map(
      recentIds.map((id, index) => [id, index] as const),
    );
    return items
      .map((item, index) => ({
        item,
        index,
        recent: recentRank.get(item.id) ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => a.recent - b.recent || a.index - b.index)
      .map(({ item }) => item);
  }

  const terms = normalizedQuery.split(" ");
  return items
    .map((item, index) => {
      const label = normalize(item.label);
      const haystack = normalize(
        [item.label, item.group, item.shortcut, ...(item.keywords ?? [])].join(
          " ",
        ),
      );
      if (!terms.every((term) => haystack.includes(term))) return null;
      const score =
        label === normalizedQuery
          ? 0
          : label.startsWith(normalizedQuery)
            ? 1
            : label.includes(normalizedQuery)
              ? 2
              : 3;
      return { item, index, score };
    })
    .filter(
      (
        result,
      ): result is { item: T; index: number; score: number } =>
        result !== null,
    )
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ item }) => item);
}

export function recordRecentCommand(
  recentIds: string[],
  commandId: string,
  limit = 8,
): string[] {
  return [commandId, ...recentIds.filter((id) => id !== commandId)].slice(
    0,
    limit,
  );
}
