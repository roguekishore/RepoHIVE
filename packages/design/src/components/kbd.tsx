import type { ReactNode } from "react";

/** A key cap, for shortcut hints. */
export function Kbd({ children }: { readonly children: ReactNode }) {
  return <kbd className="rh-kbd">{children}</kbd>;
}
