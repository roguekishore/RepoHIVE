"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Fades the page in on every route change (`.page-in`, keyed by pathname).
 * `flex-1`, not `h-full`: `main` is a flex column, so this claims the space
 * left after the route layout's breadcrumb instead of 100% of `main`.
 * Deliberately no `min-h-0`: a page taller than the viewport must still be
 * able to grow and scroll `main`, which every document page relies on.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-in flex-1">
      {children}
    </div>
  );
}
