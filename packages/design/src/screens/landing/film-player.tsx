"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/button";
import { Icon } from "../../icons/icons";
import type { LandingFigures } from "./figures-types";
import { CHAPTERS, FilmCanvas, LOOP, STILL, type FilmHandle } from "./film";
import { usePrefersReducedMotion } from "./use-reduced-motion";

/** The part of the 1600 by 1000 stage the hero frame shows: tighter than the full stage, so the picture fills a near-square frame. */
const HERO_CORE = { cx: 1060, cy: 500, w: 780, h: 820 } as const;

/** The chapter that holds time `t`. */
export function chapterAt(t: number): number {
  const index = CHAPTERS.findIndex((chapter) => t >= chapter.range[0] && t < chapter.range[1]);
  return index < 0 ? CHAPTERS.length - 1 : index;
}

/**
 * The hero film with its controls. The film is a pure function of time; this owns the clock. It loops while it is on
 * screen and playing, stops when scrolled away, and with reduced motion held it sits still on one frame and moves only
 * when a chapter is chosen.
 */
export function FilmPlayer({ figures }: { readonly figures: LandingFigures }) {
  const reduced = usePrefersReducedMotion();
  const film = useRef<FilmHandle>(null);
  const frame = useRef<HTMLDivElement>(null);
  const clock = useRef(STILL);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(true);
  const [chapter, setChapter] = useState(chapterAt(STILL));

  useEffect(() => {
    const element = frame.current;
    if (element === null || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((entry) => entry.isIntersecting)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    film.current?.paint(clock.current);
    if (reduced || !playing || !visible) return undefined;
    let last: number | undefined;
    let handle = 0;
    const tick = (now: number): void => {
      const dt = last === undefined ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      clock.current = (clock.current + dt) % LOOP;
      film.current?.paint(clock.current);
      setChapter((current) => {
        const next = chapterAt(clock.current);
        return next === current ? current : next;
      });
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [reduced, playing, visible]);

  const choose = (index: number): void => {
    const target = CHAPTERS[index];
    if (target === undefined) return;
    // A chapter opens just after its first frame, so its title has appeared.
    clock.current = target.range[0] + (reduced ? (target.range[1] - target.range[0]) * 0.8 : 0.05);
    film.current?.paint(clock.current);
    setChapter(index);
  };

  return (
    <div className="rh-ld-film">
      <div
        ref={frame}
        className="rh-ld-film-frame"
        role="img"
        aria-label={`A film of RepoHIVE indexing ${figures.repository}: a flat file graph sorts into packages, each is scored, three are kept and one is rebuilt, then the result opens as a map, a hierarchy, a decisions strip and an architecture matrix.`}
      >
        <FilmCanvas ref={film} figures={figures} initialTime={clock.current} core={HERO_CORE} />
      </div>
      <div className="rh-ld-rail" role="group" aria-label="Film chapters">
        {reduced ? null : (
          <Button type="button" size="sm" icon aria-label={playing ? "Pause the film" : "Play the film"} onClick={() => setPlaying((current) => !current)}>
            <Icon name={playing ? "minus" : "arrow"} size={14} />
          </Button>
        )}
        {CHAPTERS.map((entry, index) => (
          <button key={entry.label} type="button" className="rh-ld-chap" aria-pressed={index === chapter} onClick={() => choose(index)}>
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}
