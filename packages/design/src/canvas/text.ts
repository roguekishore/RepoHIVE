/**
 * Text on a canvas. The sizes are the product's type roles, read from the tokens at run time like the colours,
 * so a canvas never holds a size of its own.
 */
import { TEXT_ROLES, tokenVar, type TextRole } from "../tokens/names";

/** The pixel size of each type role, as the page currently resolves it. */
export type TextSizes = Readonly<Record<TextRole, number>>;

/** Used only where the page cannot resolve a token (a server render, a test without styles). */
const FALLBACK: TextSizes = { label: 11, caption: 12, body: 14, lead: 16, title: 20, heading: 24, display: 32, hero: 56 };

export function fallbackTextSizes(): TextSizes {
  return FALLBACK;
}

/** Reads `--rh-fs-<role>` for every role through a probe element appended to `root`. */
export function readTextSizes(root: Element): TextSizes {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (view === null) return FALLBACK;
  const probe = doc.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  root.appendChild(probe);
  try {
    const sizes = {} as Record<TextRole, number>;
    for (const role of TEXT_ROLES) {
      probe.style.fontSize = `var(${tokenVar(`fs-${role}`)})`;
      const px = Number.parseFloat(view.getComputedStyle(probe).fontSize);
      sizes[role] = Number.isFinite(px) && px > 0 ? px : FALLBACK[role];
    }
    return sizes;
  } finally {
    probe.remove();
  }
}

/** The largest of `steps` (ascending, pixels) that is no bigger than `size`, or the smallest when none is. */
export function snapSize(size: number, steps: readonly number[]): number {
  let chosen = steps[0] ?? size;
  for (const step of steps) if (step <= size) chosen = step;
  return chosen;
}

/** `text` shortened with an ellipsis to fit `maxWidth` in the context's current font; empty when not even one letter fits. */
export function fitText(ctx: Pick<CanvasRenderingContext2D, "measureText">, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : "";
}
