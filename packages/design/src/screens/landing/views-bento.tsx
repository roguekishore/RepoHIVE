"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LandingFigures } from "./figures-types";
import { DsmThumb, FlatThumb, HistThumb, MapThumb, SunburstThumb, StripThumb } from "./view-thumbs";
import { usePrefersReducedMotion } from "./use-reduced-motion";
import { previewFigures } from "./view-placeholders";

const number = new Intl.NumberFormat("en-US");
const COUNT_MS = 1100;

type Phase = "idle" | "arm" | "play";

/** Counts a figure up from zero while `play` is true; otherwise shows the figure as it is. */
function useCountUp(target: number, play: boolean, decimals: number): string {
  const [shown, setShown] = useState(target);
  useEffect(() => {
    if (!play) {
      setShown(target);
      return undefined;
    }
    const begin = performance.now();
    let frame = 0;
    const step = (now: number): void => {
      const p = Math.min(1, Math.max(0, (now - begin) / COUNT_MS));
      setShown(p >= 1 ? target : target * (1 - Math.pow(2, -10 * p)));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [play, target]);
  return decimals > 0 ? shown.toFixed(decimals) : number.format(Math.round(shown));
}

function OverviewThumb({ figures, play }: { readonly figures: LandingFigures; readonly play: boolean }) {
  const { counts } = figures;
  const files = useCountUp(counts.files, play, 0);
  const regions = useCountUp(counts.regions, play, 0);
  const share = useCountUp((counts.preserved / Math.max(1, counts.assessed)) * 100, play, 1);
  return (
    <div className="rh-ld-ov">
      <div>
        <b>{files}</b>
        <span>files</span>
      </div>
      <div>
        <b>{regions}</b>
        <span>regions</span>
      </div>
      <div>
        <b>{share}%</b>
        <span>kept, of measured</span>
      </div>
    </div>
  );
}

function ViewCard({ size, name, text, children }: { readonly size: "" | "big" | "wide"; readonly name: string; readonly text: string; readonly children: (play: boolean) => ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const card = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");

  // A card below the fold waits ("arm"), then plays once when it scrolls into view. Nothing waits with reduced motion.
  useEffect(() => {
    const element = card.current;
    if (reduced || element === null || typeof IntersectionObserver === "undefined") return undefined;
    if (element.getBoundingClientRect().top <= window.innerHeight) return undefined;
    setPhase("arm");
    const watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watcher.disconnect();
        setPhase("play");
      },
      { threshold: 0.3 },
    );
    watcher.observe(element);
    return () => watcher.disconnect();
  }, [reduced]);

  const classes = ["rh-ld-vcard", size === "big" ? "rh-ld-big-card" : size === "wide" ? "rh-ld-wide" : "", phase === "arm" ? "rh-ld-arm" : "", phase === "play" ? "rh-ld-play" : ""];
  return (
    <article ref={card} className={classes.filter(Boolean).join(" ")}>
      <h3>{name}</h3>
      <p>{text}</p>
      <div className="rh-ld-thumb">{children(phase === "play")}</div>
    </article>
  );
}

/** The seven views, each with a light placeholder preview. The cards are not links: they describe. */
export function ViewsBento({ figures: recorded }: { readonly figures: LandingFigures }) {
  // The marks are fixed placeholders (see view-placeholders.ts); the Overview card still reads the real counts.
  const preview = useMemo(() => previewFigures(recorded), [recorded]);
  const figures = preview;
  return (
    <div className="rh-ld-bento">
      <ViewCard size="big" name="Map" text="Zoom from the whole repository into regions, groups and files. Hover a file to trace what it depends on.">
        {() => <MapThumb figures={figures} />}
      </ViewCard>
      <ViewCard size="" name="Decisions" text="Every region on one axis, with the line that decides it.">
        {() => <StripThumb figures={figures} />}
      </ViewCard>
      <ViewCard size="" name="Hierarchy" text="Every level at once. Radius is depth, sweep is files.">
        {() => <SunburstThumb figures={figures} />}
      </ViewCard>
      <ViewCard size="" name="Architecture" text="Which groups depend on which, and how far each package was split.">
        {() => <DsmThumb figures={figures} />}
      </ViewCard>
      <ViewCard size="" name="Baseline" text="The flat file graph before any hierarchy, for comparison.">
        {() => <FlatThumb figures={figures} />}
      </ViewCard>
      <ViewCard size="wide" name="Overview" text="The repository in figures: its size, its largest regions and the snapshot it came from.">
        {(play) => <OverviewThumb figures={recorded} play={play} />}
      </ViewCard>
      <ViewCard size="wide" name="Adaptivity" text="How many regions were kept, and how their scores spread around the line.">
        {() => <HistThumb figures={figures} />}
      </ViewCard>
    </div>
  );
}
