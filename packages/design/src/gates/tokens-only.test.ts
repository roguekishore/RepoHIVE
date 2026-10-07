// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanCss, scanScript } from "./scan";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS_FILE = join(SRC, "styles", "tokens.css");
/** The colour resolver parses and formats colour syntax; it may name the functions but not hold a colour. */
const COLOR_SYNTAX_FILES = new Set([join(SRC, "canvas", "colors.ts")]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const isTest = (path: string): boolean => /\.test(?:-d)?\.tsx?$/.test(path) || path.endsWith(`${sep}test-setup.ts`);
const files = walk(SRC);
const css = files.filter((path) => path.endsWith(".css") && path !== TOKENS_FILE);
const scripts = files.filter((path) => /\.tsx?$/.test(path) && !isTest(path) && !path.includes(`${sep}gates${sep}`));

const where = (path: string): string => relative(SRC, path).split(sep).join("/");

describe("tokens only: no literal colour, font or size outside tokens.css", () => {
  it("scans the files it should (a gate over nothing passes)", () => {
    expect(css.map(where)).toEqual(expect.arrayContaining(["styles/base.css", "styles/components.css", "styles/frame.css"]));
    expect(scripts.map(where)).toEqual(expect.arrayContaining(["components/button.tsx", "frame/app-frame.tsx", "canvas/colors.ts"]));
    expect(scripts.length).toBeGreaterThan(20);
  });

  for (const path of css) {
    it(`${where(path)} holds none`, () => {
      expect(scanCss(readFileSync(path, "utf8"))).toEqual([]);
    });
  }

  for (const path of scripts) {
    it(`${where(path)} holds none`, () => {
      expect(scanScript(readFileSync(path, "utf8"), { allowColorSyntax: COLOR_SYNTAX_FILES.has(path) })).toEqual([]);
    });
  }
});

describe("the scanners fail on what they are meant to catch", () => {
  it("css: hex, colour functions, named colours, fonts and sizes", () => {
    const bad = [
      ".a { color: #fff; }",
      ".a { background: oklch(0.5 0.1 120); }",
      ".a { border: 1px solid rgb(0 0 0 / 0.2); }",
      ".a { color: red; }",
      ".a { fill: white; }",
      '.a { font-family: "Inter", sans-serif; }',
      ".a { font: 14px Arial; }",
      ".a { font-size: 13px; }",
      ".a { line-height: 20px; }",
    ];
    for (const rule of bad) {
      expect(scanCss(rule), rule).not.toEqual([]);
    }
  });

  it("css: tokens, keywords and comments pass", () => {
    const good = [
      ".a { color: var(--rh-fg); }",
      ".a { background: transparent; }",
      ".a { border: 1px solid var(--rh-line); }",
      ".a { fill: currentColor; }",
      ".a { font: inherit; }",
      ".a { font-size: var(--rh-fs-body); line-height: var(--rh-lh-body); }",
      "/* color: #fff; font-size: 13px; */",
    ];
    for (const rule of good) {
      expect(scanCss(rule), rule).toEqual([]);
    }
  });

  it("script: hex strings, colour functions, font names and font sizes", () => {
    const bad = [
      'const c = "#aabbcc";',
      "ctx.fillStyle = `rgb(10 20 30)`;",
      'const f = "14px Helvetica";',
      'style={{ fontFamily: "Arial" }}',
      "style={{ fontSize: 13 }}",
    ];
    for (const line of bad) {
      expect(scanScript(line), line).not.toEqual([]);
    }
  });

  it("script: the resolver may name colour functions but not hold a colour", () => {
    expect(scanScript('if (name === "oklch") {}', { allowColorSyntax: true })).toEqual([]);
    expect(scanScript('const c = "#aabbcc";', { allowColorSyntax: true })).not.toEqual([]);
  });

  it("script: token references and comments pass", () => {
    const good = [
      "// the colour is #fff in the old design",
      'const v = "var(--rh-fg)";',
      "const c = `var(${tokenVar(name)})`;",
      'probe.style.fontFamily = `var(${tokenVar(token)})`;',
    ];
    for (const line of good) {
      expect(scanScript(line), line).toEqual([]);
    }
  });
});
