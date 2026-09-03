"use client";

/**
 * ThemeProvider — wraps next-themes for the product dashboard.
 *
 * `attribute="class"` writes the resolved theme onto <html> as `class="dark"`
 * / `class="light"`, which the theme token contract keys off
 * (`:root` = light, `.dark` = dark overrides in @repohive/ui globals).
 *
 * `defaultTheme="dark"` — RepoHIVE is dark-first. A structural-analysis tool
 * wants a near-black, low-chroma field so the *data* carries the only
 * saturated colour on screen; the decision palette
 * (`--color-decision-preserve` / `-reconstruct` / `-degenerate`) is the thing
 * meant to draw the eye. Light remains fully supported and opt-in via the
 * shared ThemeToggle — it is the theme for print and paper figures — and the
 * choice persists (next-themes writes the `theme` localStorage key). Explicit
 * two-state, no "System" option (product decision; the toggle migrates stale
 * persisted "system" values). `disableTransitionOnChange` prevents a
 * color-transition smear when the user flips themes.
 */

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      themes={["light", "dark"]}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
