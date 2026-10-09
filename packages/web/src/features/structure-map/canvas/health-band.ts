/**
 * Health bands for the structure map. A score below `ALERT_MAX` is Alert, at
 * or above `HEALTHY_MIN` is Healthy, and the range between is Warning.
 */

export type HealthBand = "healthy" | "warning" | "alert";

/** Score at or above this is Healthy. */
export const HEALTHY_MIN = 8.0;
/** Score below this is Alert; `[ALERT_MAX, HEALTHY_MIN)` is Warning. */
export const ALERT_MAX = 4.0;

export const HEALTH_BAND_LABEL: Record<HealthBand, string> = {
  healthy: "Healthy",
  warning: "Warning",
  alert: "Alert",
};

export function bandForScore(score: number): HealthBand {
  if (score < ALERT_MAX) return "alert";
  if (score < HEALTHY_MIN) return "warning";
  return "healthy";
}

/** Literal class strings, so Tailwind's static scanner keeps them. */
const HEALTH_BAND_TEXT: Record<HealthBand, string> = {
  alert: "text-[var(--color-error)]",
  warning: "text-[var(--color-caution)]",
  healthy: "text-[var(--color-success)]",
};

export function healthBandTextColor(band: HealthBand): string {
  return HEALTH_BAND_TEXT[band];
}
