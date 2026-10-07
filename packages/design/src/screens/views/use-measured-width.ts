"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * The client width of an element, kept current by a ResizeObserver; a change of 1px or less is ignored. It is 0 until
 * the element has mounted, so a chart draws nothing before it knows its own width.
 */
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = (): void => {
      const next = element.clientWidth;
      setWidth((previous) => (Math.abs(previous - next) > 1 || (previous === 0) !== (next === 0) ? next : previous));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
