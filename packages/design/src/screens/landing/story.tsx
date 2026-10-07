"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Text } from "../../components/feedback";
import type { LandingFigures } from "./figures-types";
import { FilmCanvas, type FilmHandle } from "./film";

const number = new Intl.NumberFormat("en-US");

interface Step {
  readonly label: string;
  readonly title: string;
  readonly body: string;
  readonly note: string;
  /** The film time the step starts at and the time it ends at. */
  readonly from: number;
  readonly to: number;
}

/** The five steps. Every number in them is a figure the index recorded, read from `figures`. */
export function storySteps(figures: LandingFigures): readonly Step[] {
  const { counts, settings, regions, featured } = figures;
  const byName = new Map(regions.map((row) => [row[0], row] as const));
  const kept = byName.get(featured.kept[0] ?? "");
  const rebuilt = byName.get(featured.rebuilt);
  return [
    {
      label: "01 Parse",
      title: "Every file and every dependency",
      body: "RepoHIVE reads the Java sources on the default branch and records the imports and shared types between files. On its own, that flat graph is a tangle.",
      note: "one node per file",
      from: 0.6,
      to: 3.6,
    },
    {
      label: "02 Measure",
      title: "One score per package",
      body: "Each package becomes a region. The score rises when its files lean on each other and falls when they lean on everything else.",
      note: "cohesion · coupling · score",
      from: 4.4,
      to: 11.6,
    },
    {
      label: "03 Keep",
      title: `At ${settings.boundary} or above, the authors’ boundary stays`,
      body:
        kept === undefined
          ? "A region that holds together keeps its package exactly as written."
          : `A region that holds together keeps its package exactly as written. ${kept[0]} scored ${kept[4].toFixed(3)} and was kept.`,
      note: `${number.format(counts.preserved)} of ${number.format(counts.assessed)} measured regions kept`,
      from: 12.2,
      to: 15.3,
    },
    {
      label: "04 Rebuild",
      title: "Below it, the dependencies decide",
      body:
        rebuilt === undefined
          ? "A tangled region is split into smaller groups by the way its files actually connect."
          : `A tangled region is split into smaller groups by the way its files actually connect. ${rebuilt[0]} scored ${rebuilt[4].toFixed(3)} and became ${number.format(rebuilt[6])} groups.`,
      note: `at most ${settings.maxGroupSize} files a group`,
      from: 15.8,
      to: 19.7,
    },
    {
      label: "05 Explore",
      title: "Zoom from repository to file",
      body: `The result is a hierarchy you can zoom into, ${number.format(counts.depth)} levels deep here. Hover a card to see what it depends on. Click it to pin the trace while you keep exploring.`,
      note: "repository → groups → regions → files",
      from: 20.3,
      to: 24.5,
    },
  ];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * "How it works": five steps beside a sticky stage that shows the same film, played by where the page is scrolled.
 * The film is a pure function of time, so a scroll position is a time and the picture is the same every visit.
 */
export function Story({ figures }: { readonly figures: LandingFigures }) {
  const steps = useMemo(() => storySteps(figures), [figures]);
  const film = useRef<FilmHandle>(null);
  const refs = useRef<(HTMLElement | null)[]>([]);
  const clock = useRef(steps[0]?.from ?? 0);
  const [active, setActive] = useState(0);

  useEffect(() => {
    film.current?.paint(clock.current);
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const middle = window.innerHeight * 0.5;
      let best = -1;
      let bestDistance = Infinity;
      refs.current.forEach((element, index) => {
        if (element === null) return;
        const rect = element.getBoundingClientRect();
        const distance = middle < rect.top ? rect.top - middle : middle > rect.bottom ? middle - rect.bottom : 0;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      const step = steps[best];
      const element = refs.current[best];
      if (step === undefined || element === null || element === undefined) return;
      const rect = element.getBoundingClientRect();
      const progress = clamp01((middle - rect.top) / Math.max(1, rect.height));
      clock.current = step.from + (step.to - step.from) * progress;
      film.current?.paint(clock.current);
      setActive(best);
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [steps]);

  return (
    <div className="rh-ld-story">
      <div className="rh-ld-steps">
        {steps.map((step, index) => (
          <article
            key={step.label}
            ref={(element) => {
              refs.current[index] = element;
            }}
            className="rh-ld-step"
            aria-current={index === active ? "step" : undefined}
          >
            <Text role="label">{step.label}</Text>
            <Text as="h3" role="heading">
              {step.title}
            </Text>
            <Text role="lead" tone="subtle">
              {step.body}
            </Text>
            <span className="rh-ld-code">{step.note}</span>
          </article>
        ))}
      </div>
      <div className="rh-ld-stage" aria-hidden="true">
        <div className="rh-ld-stage-frame">
          <FilmCanvas ref={film} figures={figures} initialTime={clock.current} />
        </div>
        <Text role="label" className="rh-ld-stage-label">
          {steps[active]?.label}
        </Text>
      </div>
    </div>
  );
}
