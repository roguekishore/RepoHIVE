/**
 * The scanners behind the tokens-only gate (`tokens-only.test.ts`). They are plain functions over text so the gate can
 * be shown to fail on bad input: a gate that has never failed proves nothing.
 *
 * Rule: a colour, a font family or a font size is a token. `styles/tokens.css` is the only file that may hold one as a
 * literal; everything else reads a custom property.
 */

export interface Violation {
  readonly line: number;
  readonly rule: string;
  readonly text: string;
}

const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i;
const HEX_COLOR = /#[0-9a-f]{3,8}\b/i;
const NAMED_COLOR =
  /\b(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|navy|teal|maroon|olive|lime|aqua|fuchsia|brown|gold|cyan|magenta|coral|crimson|indigo|violet|salmon|tan)\b/i;
/** Declarations whose value is a colour, where a named colour would be a literal. */
const COLOR_PROPERTY = /^(?:color|background(?:-color)?|border(?:-[a-z]+)*|fill|stroke|outline(?:-color)?|box-shadow|text-decoration-color|caret-color|accent-color)$/;
const FONT_NAME = /(?:host grotesk|geist|helvetica|arial|sans-serif|monospace|ui-monospace|menlo|consolas|sf ?mono|times|georgia|serif)/i;

/** A value that reads a token (or inherits one). */
const TOKEN_OR_INHERIT = /^(?:var\(|inherit$)/;

function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

/** CSS outside the tokens file. */
export function scanCss(text: string): Violation[] {
  const found: Violation[] = [];
  const lines = stripCssComments(text).split("\n");
  lines.forEach((raw, index) => {
    const line = raw.trim();
    // A line holds one declaration, or a whole one-line rule in a test; read every `property: value` in it.
    for (const declaration of line.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
      const property = (declaration[1] ?? "").toLowerCase();
      const value = (declaration[2] ?? "").trim();
      const report = (rule: string): void => {
        found.push({ line: index + 1, rule, text: line });
      };
      if (property.startsWith("--")) continue; // custom properties defined here are a different failure (see tokens test)
      if (HEX_COLOR.test(value)) report("hex colour");
      if (COLOR_FUNCTION.test(value)) report("colour function");
      if (COLOR_PROPERTY.test(property) && NAMED_COLOR.test(value)) report("named colour");
      if (property === "font-family" && !TOKEN_OR_INHERIT.test(value)) report("font-family literal");
      if (property === "font" && value !== "inherit") report("font shorthand");
      if ((property === "font-size" || property === "line-height") && !TOKEN_OR_INHERIT.test(value)) {
        report(`${property} is not a token`);
      }
    }
  });
  return found;
}

/** Strips `//` and block comments from TS/TSX, keeping line numbers. */
function stripScriptComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (_match, lead: string) => lead);
}

export interface ScriptScanOptions {
  /** The colour resolver parses and formats colour syntax by name; it may mention the functions but not a literal colour. */
  readonly allowColorSyntax?: boolean;
}

/** TS and TSX outside the tokens file. */
export function scanScript(text: string, options: ScriptScanOptions = {}): Violation[] {
  const found: Violation[] = [];
  stripScriptComments(text)
    .split("\n")
    .forEach((line, index) => {
      const report = (rule: string): void => {
        found.push({ line: index + 1, rule, text: line.trim() });
      };
      // A hex colour inside a string literal. `#` also starts an id selector or a private field, so require quotes.
      if (/["'`]#[0-9a-f]{3,8}["'`]/i.test(line)) report("hex colour");
      if (!options.allowColorSyntax && /["'`][^"'`]*\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i.test(line)) {
        report("colour function");
      }
      // An assignment or an object property, not a read such as `getComputedStyle(x).fontFamily`.
      if (/\b(?:fontFamily|font-family)\b["']?\s*[:=]/.test(line) && !/var\(/.test(line)) report("font-family literal");
      if (/["'`][^"'`]*(?:host grotesk|geist mono|helvetica|arial)/i.test(line) && FONT_NAME.test(line)) {
        report("font name literal");
      }
      if (/\bfontSize\s*:/.test(line)) report("fontSize literal");
    });
  return found;
}
