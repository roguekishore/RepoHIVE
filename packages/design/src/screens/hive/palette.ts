import { domColorSource, readPalette, watchPalette, type CanvasPalette } from "../../canvas/colors";

/** The palette as `root` sees it. The colours are global; the landing reads them from its own element so the scenes follow it. */
export function readScopedPalette(root: Element): CanvasPalette | undefined {
  try {
    return readPalette(domColorSource(root));
  } catch {
    // A page without styles (a server render, a test DOM) has nothing to read; the canvas then stays blank.
    return undefined;
  }
}

/**
 * Calls `onChange` now and whenever the theme can have changed. Returns the function that stops watching. A palette
 * that cannot be read is skipped rather than thrown.
 */
export function watchScopedPalette(root: Element, onChange: (palette: CanvasPalette) => void): () => void {
  const first = readScopedPalette(root);
  if (first !== undefined) onChange(first);
  let source;
  try {
    source = domColorSource(root);
  } catch {
    return () => undefined;
  }
  return watchPalette(root.ownerDocument, source, (palette) => onChange(palette));
}

/** Whether the visitor asked for less motion, read now. The animation loops read it each frame through a ref. */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
