import type { CanvasPalette } from "../../../canvas/colors";
import type { FilmColors, FilmFonts } from "./film-draw";

/**
 * The film's colours, read from the shared canvas palette: ink is the foreground, accent is what was computed, and the
 * ground is the surface token, so the film sits on the same card colour as the page around it and follows the theme.
 */
export function filmColors(palette: CanvasPalette): FilmColors {
  const c = palette.colors;
  return { g: c.surface, ink: c.fg, fg2: c["fg-2"], fg3: c["fg-3"], line: c.line, ls: c["line-strong"], acc: c.accent, surf: c.surface };
}

export function filmFonts(palette: CanvasPalette): FilmFonts {
  return { sans: palette.sans, mono: palette.mono };
}
