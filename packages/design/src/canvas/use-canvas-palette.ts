"use client";

import { useEffect, useState } from "react";
import { domColorSource, readPalette, watchPalette, type CanvasPalette, type ColorSource } from "./colors";

/**
 * The current canvas palette, or `undefined` until the page has mounted (a server render has no styles to read). It
 * changes identity when the theme does, so a canvas that lists it as an effect dependency repaints on its own.
 * `source` is for tests; a page leaves it out.
 */
export function useCanvasPalette(source?: ColorSource): CanvasPalette | undefined {
  const [palette, setPalette] = useState<CanvasPalette | undefined>(undefined);

  useEffect(() => {
    const doc = document;
    const colors = source ?? domColorSource(doc.documentElement);
    setPalette(readPalette(colors));
    return watchPalette(doc, colors, setPalette);
  }, [source]);

  return palette;
}
