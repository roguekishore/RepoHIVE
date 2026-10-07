"use client";

import { useEffect, useState, type RefObject } from "react";

export interface ElementSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The size of an element in CSS pixels, kept current by a ResizeObserver. It is `{ 0, 0 }` until the element has
 * mounted and been measured, so a caller draws nothing before then.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = (): void => {
      const next = { width: Math.round(element.clientWidth), height: Math.round(element.clientHeight) };
      setSize((previous) => (previous.width === next.width && previous.height === next.height ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
