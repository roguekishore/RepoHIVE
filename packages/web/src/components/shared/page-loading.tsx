import { BrandLogo } from "./brand-logo";

/** Route loading state: the brand mark, pulsing, with a status label. */
export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
      <span className="motion-safe:animate-pulse">
        <BrandLogo size={96} />
      </span>
      <span className="text-sm text-[var(--color-text-tertiary)]">{label}</span>
    </div>
  );
}
