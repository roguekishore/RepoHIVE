/**
 * The dotted prefix every name in a list shares, kept whole-segment and with the trailing dot (`org.acme.`), or `""`.
 * Every name keeps at least one segment, so a name that is itself the shared prefix leaves nothing to strip.
 */
export function commonNamePrefix(names: readonly string[]): string {
  const first = names[0];
  if (first === undefined) return "";
  let shared = first.split(".");
  for (const name of names) {
    const parts = name.split(".");
    let length = 0;
    while (length < shared.length && length < parts.length && shared[length] === parts[length]) length += 1;
    shared = shared.slice(0, length);
    if (shared.length === 0) return "";
  }
  const shortest = Math.min(...names.map((name) => name.split(".").length));
  const keep = Math.min(shared.length, shortest - 1);
  return keep <= 0 ? "" : `${shared.slice(0, keep).join(".")}.`;
}

/** A name without the prefix `commonNamePrefix` found. */
export function shortName(name: string, prefix: string): string {
  return prefix !== "" && name.startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : name;
}

const LEVEL_NAMES: readonly string[] = ["Repository", "Layers", "Groups", "Regions", "Subgroups", "Files", "Symbols"];

/**
 * A hierarchy level's name. The index records no name per level, so the fixed names apply only to a hierarchy of
 * exactly seven levels (0 to 6); any other depth falls back to `Level N`.
 */
export function levelName(level: number, levelCount: number): string {
  return levelCount === LEVEL_NAMES.length ? (LEVEL_NAMES[level] ?? `Level ${level}`) : `Level ${level}`;
}
