
/** 1–10 bands. Shared with HealthOverviewCard's thresholds on purpose: two
 *  surfaces disagreeing about what "Good" means is worse than duplication. */
export function healthBand(v: number): { color: string; label: string } {
  if (v >= 8) return { color: "var(--color-success)", label: "Excellent" };
  if (v >= 6.5) return { color: "var(--color-success)", label: "Good" };
  if (v >= 5) return { color: "var(--color-caution)", label: "Fair" };
  if (v >= 3.5) return { color: "var(--color-warning)", label: "Needs work" };
  return { color: "var(--color-error)", label: "Critical" };
}
