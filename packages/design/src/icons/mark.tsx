import type { SVGAttributes } from "react";

export interface MarkProps extends Omit<SVGAttributes<SVGSVGElement>, "viewBox" | "children"> {
  readonly size?: number;
  /** Set when the mark stands alone; next to the wordmark it is decoration. */
  readonly label?: string;
}

/**
 * The mark: three solid cells and one cell broken into four. Kept regions are solid, rebuilt ones are cut up. The
 * ink and the accent come from the tokens (`.rh-mark-ink`, `.rh-mark-accent`), so the mark follows the theme.
 */
export function Mark({ size = 20, label, ...rest }: MarkProps) {
  const labelled = label === undefined ? { "aria-hidden": true as const } : { role: "img" as const, "aria-label": label };
  return (
    <svg className="rh-mark" width={size} height={size} viewBox="0 0 24 24" focusable="false" {...labelled} {...rest}>
      <rect className="rh-mark-ink" x="1" y="1" width="10" height="10" />
      <rect className="rh-mark-ink" x="1" y="13" width="10" height="10" />
      <rect className="rh-mark-ink" x="13" y="13" width="10" height="10" />
      <rect className="rh-mark-accent" x="13" y="1" width="4" height="4" />
      <rect className="rh-mark-accent" x="19" y="1" width="4" height="4" />
      <rect className="rh-mark-accent" x="13" y="7" width="4" height="4" />
      <rect className="rh-mark-accent" x="19" y="7" width="4" height="4" />
    </svg>
  );
}

/** The name, set in the brand style. */
export function Wordmark({ className }: { readonly className?: string }) {
  return <span className={className === undefined ? "rh-wordmark" : `rh-wordmark ${className}`}>RepoHIVE</span>;
}

/** The mark and the name together, as the sidebar and the landing navigation show them. */
export function Brand({ markSize = 20 }: { readonly markSize?: number }) {
  return (
    <span className="rh-brand">
      <Mark size={markSize} />
      <Wordmark />
    </span>
  );
}
