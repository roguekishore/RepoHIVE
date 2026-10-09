import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The small mono, uppercase, letter-spaced label that opens a section
 * ("INDEXED REPOSITORIES"). One definition so every section heading reads alike.
 */
export function SectionLabel({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        "font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]",
        className,
      )}
      {...props}
    />
  );
}
