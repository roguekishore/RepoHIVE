"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "repohive-theme";

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Puts a preference on the root element: `data-theme="light"` or `"dark"` overrides, and no attribute follows the
 * system setting (the tokens' media query).
 */
export function applyTheme(preference: ThemePreference, root: HTMLElement): void {
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

/**
 * A script for the document head that applies the stored preference before first paint, so a returning visitor with
 * an override never sees the other theme flash. Embed with `dangerouslySetInnerHTML`. It is a plain string with no
 * dependency on this package at run time.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

function browserStorage(): ThemeStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

interface ThemeContextValue {
  readonly preference: ThemePreference;
  readonly setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * Holds the preference. The first render, on the server and in the browser, is `system`, so the two agree; the stored
 * value is read once the page has mounted.
 */
export function ThemeProvider({ children, storage }: { children: ReactNode; storage?: ThemeStorage }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    const store = storage ?? browserStorage();
    let stored: string | null = null;
    try {
      stored = store?.getItem(THEME_STORAGE_KEY) ?? null;
    } catch {
      stored = null;
    }
    if (isThemePreference(stored)) {
      setPreferenceState(stored);
      applyTheme(stored, document.documentElement);
    }
  }, [storage]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      applyTheme(next, document.documentElement);
      try {
        (storage ?? browserStorage())?.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Storage can be blocked; the choice still applies for this page.
      }
    },
    [storage],
  );

  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === undefined) throw new Error("useTheme must be used inside a DesignProvider");
  return value;
}
