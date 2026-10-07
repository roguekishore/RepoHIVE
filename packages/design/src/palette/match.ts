/**
 * Ranking for the search palette. A name that starts with the query beats one that merely contains it, and a shorter
 * name beats a longer one at the same tier. Equal scores keep their input order, so the result is stable.
 */

/** Lower is better; `-1` means no match. `needle` is already lower-cased. */
export function matchScore(name: string, needle: string): number {
  const at = name.toLowerCase().indexOf(needle);
  if (at < 0) return -1;
  return (at === 0 ? 0 : 100) + name.length;
}

/** The best `limit` matches in rank order. An empty query returns the first `limit` unranked. */
export function rankMatches<T>(items: readonly T[], nameOf: (item: T) => string, query: string, limit: number): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return items.slice(0, limit);
  const scored: { score: number; item: T }[] = [];
  for (const item of items) {
    const score = matchScore(nameOf(item), needle);
    if (score >= 0) scored.push({ score, item });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((entry) => entry.item);
}
