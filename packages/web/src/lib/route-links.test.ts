import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard for links into routes that are only redirects.
 *
 * Sections get merged and their old routes stay behind as one-line redirect
 * stubs, which is right — people have those URLs bookmarked. What is not right
 * is our own navigation still pointing at them. Nothing errors: the click
 * works, it just costs an extra hop, and the destination silently stops being
 * the one the label promised. `/risk` with no tab lands on Code Health's
 * Overview, so a link labelled "Review threshold" arrived somewhere that never
 * mentions one.
 *
 * A sweep at the time this was written found eleven such links across six
 * routes, every one of them from a stat or section heading that named
 * something the destination did not show.
 */

const WEB_SRC = join(__dirname, "..");
const UI_SRC = join(__dirname, "../../../ui/src");
/** The reachable repository routes. */
const LIVE_ROUTES = join(WEB_SRC, "app/repos/[owner]/[repo]");

/**
 * Deep links we keep pointing at a redirect on purpose. Empty since the
 * shell cull (only `c4` and `zoom` survive as stubs, both landing on the real
 * Knowledge Graph); kept as a set so a future deliberate alias has a home.
 */
const DELIBERATE = new Set<string>([]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/**
 * Top-level route segments under `/repos/{id}` whose page only redirects.
 *
 * A stub has no JSX to return — that is what separates it from a real page
 * that happens to redirect on one branch, such as an auth guard.
 */
function redirectOnlySegments(): Set<string> {
  const out = new Set<string>();
  for (const root of [LIVE_ROUTES]) collectStubs(root, out);
  return out;
}

function collectStubs(root: string, out: Set<string>): void {
  for (const entry of readdirSync(root)) {
    if (entry.startsWith("[")) continue;
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    let page: string;
    try {
      page = readFileSync(join(dir, "page.tsx"), "utf8");
    } catch {
      continue;
    }
    if (page.includes("redirect") && !page.includes("return (")) out.add(entry);
  }
}

/** Every `${base}/seg` or `/repos/${id}/seg` written on a line carrying an href. */
function linkedSegments(files: string[]): Map<string, string[]> {
  const pattern = /(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|\/repos\/\$\{[^}]+\})\/([a-z][a-z-]*)/g;
  const found = new Map<string, string[]>();
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!line.includes("href") && !line.includes("Href")) return;
      for (const m of line.matchAll(pattern)) {
        const seg = m[1]!;
        const at = `${file}:${i + 1}`;
        const seen = found.get(seg) ?? [];
        if (!seen.includes(at)) seen.push(at);
        found.set(seg, seen);
      }
    });
  }
  return found;
}

describe("route links", () => {
  it("points at no route that is only a redirect", () => {
    const stubs = redirectOnlySegments();
    const linked = linkedSegments([...walk(WEB_SRC), ...walk(UI_SRC)]);

    const offenders = [...linked.entries()]
      .filter(([seg]) => stubs.has(seg) && !DELIBERATE.has(seg))
      .map(([seg, at]) => `/${seg} <- ${at.join(", ")}`)
      .sort();

    expect(offenders).toEqual([]);
  });

  it("finds stubs and links at all, so a broken matcher cannot pass vacuously", () => {
    // After the shell cull exactly two stubs remain — the old `/c4` and
    // `/zoom` URLs, kept because they land on the real Knowledge Graph.
    expect(redirectOnlySegments()).toEqual(new Set(["zoom"]));
    expect(linkedSegments([...walk(WEB_SRC), ...walk(UI_SRC)]).size).toBeGreaterThan(5);
  });

  it("keeps the deliberate-allowance set honest", () => {
    // Every entry in DELIBERATE must still be a live redirect stub; a stale
    // allowance should shrink rather than quietly cover a real page. The wiki
    // entry died with the shell cull — its stub forwarded into the dead docs
    // surface and was deleted.
    const stubs = redirectOnlySegments();
    for (const seg of DELIBERATE) expect(stubs.has(seg)).toBe(true);
  });
});
