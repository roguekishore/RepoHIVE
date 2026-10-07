"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/button";
import { Icon } from "../../icons/icons";
import type { LandingFigures } from "./figures-types";
import { CHAPTERS, FilmCanvas, LOOP, STILL, type FilmHandle } from "./film";
import { usePrefersReducedMotion } from "./use-reduced-motion";

/** The part of the 1600 by 1000 stage the hero frame shows. */
const HERO_CORE = { cx: 1060, cy: 500, w: 780, h: 760 } as const;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const two = (n: number): string => (n < 10 ? `0${n}` : String(n));
const mmss = (seconds: number): string => `${Math.floor(Math.floor(seconds) / 60)}:${two(Math.floor(seconds) % 60)}`;

/** The chapter that holds time `t`. */
export function chapterAt(t: number): number {
  const index = CHAPTERS.findIndex((chapter) => t >= chapter.range[0] && t < chapter.range[1]);
  return index < 0 ? CHAPTERS.length - 1 : index;
}

/**
 * The hero film with its rail. The film is a pure function of time; this owns the clock. It plays while it is on screen
 * and the tab is visible, and with reduced motion held it starts paused on one frame and moves only when a chapter is
 * chosen or play is pressed.
 */
export function FilmPlayer({ figures }: { readonly figures: LandingFigures }) {
  const reduced = usePrefersReducedMotion();
  const film = useRef<FilmHandle>(null);
  const frame = useRef<HTMLDivElement>(null);
  const clock = useRef(STILL);
  const fills = useRef<(HTMLElement | null)[]>([]);
  const clockLabel = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(true);
  const [onScreen, setOnScreen] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const [chapter, setChapter] = useState(chapterAt(STILL));

  // With reduced motion the film starts paused on its still frame, and the play button is still there.
  useEffect(() => {
    if (reduced) setPlaying(false);
  }, [reduced]);

  const refresh = useCallback((): void => {
    const t = clock.current;
    CHAPTERS.forEach((entry, index) => {
      const fill = fills.current[index];
      if (fill) fill.style.width = `${(clamp01((t - entry.range[0]) / (entry.range[1] - entry.range[0])) * 100).toFixed(1)}%`;
    });
    if (clockLabel.current) clockLabel.current.textContent = `${mmss(t)} / ${mmss(LOOP)}`;
    const next = chapterAt(t);
    setChapter((current) => (current === next ? current : next));
  }, []);

  useEffect(() => {
    const element = frame.current;
    if (element === null || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => setOnScreen(entries.some((entry) => entry.isIntersecting)), { rootMargin: "80px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const change = (): void => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);

  useEffect(() => {
    film.current?.paint(clock.current);
    refresh();
    if (!playing || !onScreen || !pageVisible) return undefined;
    let last: number | undefined;
    let handle = 0;
    const tick = (now: number): void => {
      const dt = last === undefined ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      clock.current = (clock.current + dt) % LOOP;
      film.current?.paint(clock.current);
      refresh();
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, onScreen, pageVisible, refresh]);

  const choose = (index: number): void => {
    const target = CHAPTERS[index];
    if (target === undefined) return;
    clock.current = target.range[0] + 0.01;
    film.current?.paint(clock.current);
    refresh();
  };

  return (
    <div className="rh-ld-hero-film">
      <div
        ref={frame}
        className="rh-ld-film-frame"
        role="img"
        aria-label={`A film of RepoHIVE indexing ${figures.repository}: a flat file graph sorts into packages, each is scored, three are kept and one is rebuilt, then the result opens as a map, a hierarchy, a decisions strip and an architecture matrix.`}
      >
        <FilmCanvas ref={film} figures={figures} initialTime={clock.current} core={HERO_CORE} />
      </div>
      <div className="rh-ld-rail" role="group" aria-label="Film chapters">
        <Button type="button" variant="ghost" icon className="rh-ld-play" aria-label={playing ? "Pause the film" : "Play the film"} onClick={() => setPlaying((current) => !current)}>
          <Icon name={playing ? "pause" : "play"} size={14} />
        </Button>
        {CHAPTERS.map((entry, index) => (
          <button
            key={entry.label}
            type="button"
            className={index === chapter ? "rh-ld-chap rh-ld-on" : "rh-ld-chap"}
            aria-label={`Chapter ${index + 1}: ${entry.label}`}
            aria-current={index === chapter ? "step" : undefined}
            onClick={() => choose(index)}
          >
            <span className="rh-ld-trk">
              <i
                ref={(element) => {
                  fills.current[index] = element;
                }}
              />
            </span>
            <span className="rh-ld-chap-name">{entry.label}</span>
          </button>
        ))}
        <span ref={clockLabel} className="rh-ld-clock" />
      </div>
    </div>
  );
}
