"use client";

import { useRef, type ReactNode } from "react";
import { useMeasuredWidth } from "./use-measured-width";

/** A chart container that tells its child how wide it is, so the child draws at real size. Nothing is drawn until measured. */
export function Measured({ children, className = "rh-dec-viz" }: { readonly children: (width: number) => ReactNode; readonly className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(ref);
  return (
    <div ref={ref} className={className}>
      {width === 0 ? null : children(width)}
    </div>
  );
}
