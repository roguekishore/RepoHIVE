/**
 * The names of the tokens in `styles/tokens.css`, which is the only place a value lives. This file holds names, not
 * values, so canvases and tests can ask for a token without repeating a colour. `tokens.test.ts` checks that every
 * name here is defined in the CSS in both themes and that the CSS defines nothing this file does not name.
 */

export const COLOR_TOKENS = [
  "bg",
  "surface",
  "sunken",
  "line",
  "line-strong",
  "fg",
  "fg-2",
  "fg-3",
  "accent",
  "accent-soft",
  "on-accent",
  "rebuilt",
  "ok",
  "warn",
  "err",
  "scrim",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

export const FONT_TOKENS = ["font-sans", "font-mono"] as const;
export type FontToken = (typeof FONT_TOKENS)[number];

/** The eight type roles. Each has `--rh-fs-<role>` and `--rh-lh-<role>`. */
export const TEXT_ROLES = ["label", "caption", "body", "lead", "title", "heading", "display", "hero"] as const;
export type TextRole = (typeof TEXT_ROLES)[number];

/** The CSS custom property that holds a token, for example `--rh-line-strong`. */
export function tokenVar(name: string): string {
  return `--rh-${name}`;
}

/** `var(--rh-<name>)`, for inline styles that must still read a token. */
export function tokenRef(name: string): string {
  return `var(${tokenVar(name)})`;
}
