/*
 * Atmosphere — original layered-gradient "aurora" + film grain.
 * Recreates the premium warm-light feel with pure CSS/SVG (no raster asset).
 * All colors come from tokens (--aurora-*). Purely decorative; aria-hidden.
 */

export function HeroAurora() {
  return (
    <div className="aurora" aria-hidden="true">
      <span className="aurora__flare aurora__flare--left" />
      <span className="aurora__flare aurora__flare--right" />
      <span className="aurora__pool aurora__pool--bl" />
      <span className="aurora__pool aurora__pool--br" />
      <span className="aurora__streak" />
      <span className="aurora__vignette" />
    </div>
  );
}

/* Softer glow used to give mid-page sections depth without the full hero aurora. */
export function SectionGlow({ tone = "amber" }: { tone?: "amber" | "violet" }) {
  return <div className={`secglow secglow--${tone}`} aria-hidden="true" />;
}

/* Full-page fixed grain overlay for tactile, premium texture. */
export function Grain() {
  return <div className="grain" aria-hidden="true" />;
}
