// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR_TOKENS, FONT_TOKENS, TEXT_ROLES, tokenRef, tokenVar } from "./names";
import { STYLES_DIR as STYLES, readTokenBlocks, referencedTokens } from "./tokens-css";

const blocks = readTokenBlocks();

describe("tokens.css", () => {
  it("defines every named colour in the light theme", () => {
    for (const name of COLOR_TOKENS) {
      expect(blocks.light.get(tokenVar(name)), name).toMatch(/^oklch\(/);
    }
  });

  it("defines no colour the names file does not list", () => {
    const named = new Set(COLOR_TOKENS.map(tokenVar));
    const strays = [...blocks.light].filter(([name, value]) => value.startsWith("oklch(") && !named.has(name));
    expect(strays).toEqual([]);
  });

  it("overrides exactly the colours in both dark blocks, with the same values", () => {
    const colours = COLOR_TOKENS.map(tokenVar);
    for (const dark of [blocks.darkSystem, blocks.darkOverride]) {
      const overridden = [...dark.keys()].filter((name) => name !== "color-scheme").sort();
      expect(overridden).toEqual([...colours].sort());
      expect(dark.get("color-scheme")).toBe("dark");
    }
    for (const name of colours) {
      expect(blocks.darkSystem.get(name), name).toBe(blocks.darkOverride.get(name));
    }
  });

  it("differs between the themes for the grounds and the ink", () => {
    for (const name of ["bg", "surface", "sunken", "fg", "fg-2", "accent"] as const) {
      expect(blocks.light.get(tokenVar(name))).not.toBe(blocks.darkOverride.get(tokenVar(name)));
    }
  });

  it("defines both font stacks", () => {
    for (const name of FONT_TOKENS) {
      expect(blocks.light.get(tokenVar(name)), name).toBeTruthy();
    }
    expect(blocks.light.get("--rh-font-sans")).toContain("Host Grotesk");
    expect(blocks.light.get("--rh-font-mono")).toContain("Geist Mono");
  });

  it("has exactly the eight type roles, with line heights on a 4px grid", () => {
    const sizes = [...blocks.light.keys()].filter((name) => name.startsWith("--rh-fs-"));
    expect(sizes.sort()).toEqual(TEXT_ROLES.map((role) => `--rh-fs-${role}`).sort());
    const expected: Record<string, [number, number]> = {
      label: [11, 16],
      caption: [12, 16],
      body: [14, 20],
      lead: [16, 24],
      title: [20, 28],
      heading: [24, 32],
      display: [32, 40],
      hero: [56, 64],
    };
    for (const role of TEXT_ROLES) {
      const size = Number.parseInt(blocks.light.get(`--rh-fs-${role}`) ?? "", 10);
      const line = Number.parseInt(blocks.light.get(`--rh-lh-${role}`) ?? "", 10);
      expect([size, line], role).toEqual(expected[role]);
      expect(line % 4, `${role} line height`).toBe(0);
    }
  });

  it("keeps space on a 4px grid and the radius at 4px", () => {
    for (const [name, value] of blocks.light) {
      if (!/^--rh-space-\d+$/.test(name) || value === "0") continue;
      expect(Number.parseInt(value, 10) % 4, name).toBe(0);
    }
    expect(blocks.light.get("--rh-radius")).toBe("4px");
  });

  it("sets the frame sizes of the Kernel · Moss spec", () => {
    expect(blocks.light.get("--rh-sidebar-width")).toBe("216px");
    expect(blocks.light.get("--rh-header-height")).toBe("48px");
    expect(blocks.light.get("--rh-status-height")).toBe("28px");
    expect(blocks.light.get("--rh-inspector-width")).toBe("212px");
    expect(blocks.light.get("--rh-ease")).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
  });

  it("holds the seed colours from the plan", () => {
    expect(blocks.light.get("--rh-accent")).toBe("oklch(0.5 0.1 132)");
    expect(blocks.darkOverride.get("--rh-accent")).toBe("oklch(0.8 0.12 128)");
    expect(blocks.light.get("--rh-rebuilt")).toBe("oklch(0.52 0.13 300)");
    expect(blocks.darkOverride.get("--rh-rebuilt")).toBe("oklch(0.74 0.11 305)");
    expect(blocks.light.get("--rh-neutral-hue")).toBe("125");
    expect(blocks.light.get("--rh-neutral-chroma")).toBe("0.008");
  });
});

describe("every token the styles read is defined", () => {
  const defined = new Set(blocks.light.keys());
  const sheets = readdirSync(STYLES).filter((name) => name.endsWith(".css") && name !== "index.css");

  for (const sheet of sheets) {
    it(`${sheet}`, () => {
      const undefinedRefs = referencedTokens(readFileSync(join(STYLES, sheet), "utf8")).filter((name) => !defined.has(name));
      expect(undefinedRefs).toEqual([]);
    });
  }

  it("reads at least one token from each sheet (the check is not vacuous)", () => {
    for (const sheet of sheets.filter((name) => name !== "tokens.css")) {
      expect(referencedTokens(readFileSync(join(STYLES, sheet), "utf8")).length, sheet).toBeGreaterThan(0);
    }
  });
});

describe("tokenVar and tokenRef", () => {
  it("name the custom property", () => {
    expect(tokenVar("line-strong")).toBe("--rh-line-strong");
    expect(tokenRef("bg")).toBe("var(--rh-bg)");
  });
});
