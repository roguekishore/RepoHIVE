"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * `false` while rendering on the server and during hydration, `true` once the
 * component is mounted in the browser. The static-export shells read the real
 * URL only after this, so the prerendered placeholder never mismatches.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
