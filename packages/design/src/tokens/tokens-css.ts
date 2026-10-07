/**
 * Reads `styles/tokens.css` as data, for tests and tooling. Not used by the components: they use the CSS itself.
 * Node only (it reads the file), so nothing in the browser bundle imports it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const STYLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "styles");
export const TOKENS_CSS_PATH = join(STYLES_DIR, "tokens.css");

export type Declarations = ReadonlyMap<string, string>;

export interface TokenBlocks {
  /** `:root`: the light theme and every non-colour token. */
  readonly light: Declarations;
  /** `:root:not([data-theme="light"])` inside the dark media query: the system preference. */
  readonly darkSystem: Declarations;
  /** `:root[data-theme="dark"]`: the explicit override. */
  readonly darkOverride: Declarations;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function declarationsOf(body: string): Declarations {
  const map = new Map<string, string>();
  for (const part of body.split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).replace(/\s+/g, " ").trim();
    if (name !== "") map.set(name, value);
  }
  return map;
}

function blockAfter(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`tokens.css has no block for ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

export function readTokenBlocks(css: string = readFileSync(TOKENS_CSS_PATH, "utf8")): TokenBlocks {
  const text = stripComments(css);
  return {
    light: declarationsOf(blockAfter(text, ":root")),
    darkSystem: declarationsOf(blockAfter(text, ':root:not([data-theme="light"])')),
    darkOverride: declarationsOf(blockAfter(text, ':root[data-theme="dark"]')),
  };
}

/** Every `--rh-*` custom property the given CSS reads through `var()`. */
export function referencedTokens(css: string): string[] {
  const names = new Set<string>();
  for (const match of stripComments(css).matchAll(/var\(\s*(--rh-[a-z0-9-]+)/g)) {
    if (match[1] !== undefined) names.add(match[1]);
  }
  return [...names].sort();
}
