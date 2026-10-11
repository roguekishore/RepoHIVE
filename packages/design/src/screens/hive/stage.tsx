"use client";

import { useEffect, useRef, useState } from "react";
import { useHive } from "./context";
import { HiveIndexForm } from "./form";
import { clamp, RING_LABELS, type RingLabel } from "./model";
import { startStageScene, type StageControl } from "./stage-scene";

/**
 * The pinned animation. The section is six screens tall and its picture is sticky; scroll position is the clock.
 * Five phases: the tangle, a cell per file, kept against rebuilt, one plate per level, and the plates turned into the
 * rings of the hierarchy. The picture carries each phase; its copy is one line in the bottom corner.
 */
export function HiveStage() {
  const { figures, model, strata, root, tip } = useHive();
  const c = figures.counts;
  const stage = useRef<HTMLElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const plateTags = useRef<(HTMLElement | null)[]>([]);
  const ringTags = useRef<(HTMLElement | null)[]>([]);
  const control = useRef<StageControl>({ prog: 0, inView: true, cur: 0 });
  const [cur, setCur] = useState(0);
  const [noGl, setNoGl] = useState(false);

  // The picture names its parts and leaves the sizes to the explorer, where a visitor asks for one by pointing at it.
  const plateText: readonly RingLabel[] = [
    { head: "Files", tail: "" },
    { head: "Level 3", tail: " · regions" },
    { head: "Level 2", tail: " · groups" },
    { head: "Level 1", tail: " · groups" },
  ];
  const counter: readonly (readonly [string, string])[] = [
    ["Tangled", "one flat graph"],
    ["Cells", "one per file"],
    ["Judged", "kept or rebuilt, region by region"],
    ["Layered", "one plate per level"],
    ["Mapped", "four levels, one hive"],
  ];
  // The split of the regions is drawn in proportion, with no figure beside it.
  const split: readonly (readonly [string, number, string])[] = [
    ["k", c.preserved, "Kept"],
    ["r", c.reconstructed, "Rebuilt"],
    ["u", c.degenerate, "Too small"],
  ];

  // Scroll sets the phase and the progress; this part works without WebGL. The section's position and length are
  // measured when the layout changes, not on every scroll event, so a scroll never forces a layout of its own.
  useEffect(() => {
    const el = stage.current;
    if (!el) return undefined;
    const ctl = control.current;
    let top = 0;
    let span = 0;
    const measure = (): void => {
      top = el.getBoundingClientRect().top + window.scrollY;
      span = el.offsetHeight - window.innerHeight;
    };
    const read = (): void => {
      ctl.prog = span > 0 ? clamp((window.scrollY - top) / span, 0, 1) : 0;
      const k = Math.round(ctl.prog * 4);
      if (k !== ctl.cur) {
        ctl.cur = k;
        setCur(k);
      }
    };
    const remeasure = (): void => {
      measure();
      read();
    };
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            for (const e of entries) ctl.inView = e.isIntersecting;
          })
        : undefined;
    io?.observe(el);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(remeasure) : undefined;
    ro?.observe(el);
    ro?.observe(document.body);
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", remeasure);
    remeasure();
    return () => {
      io?.disconnect();
      ro?.disconnect();
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", remeasure);
    };
  }, []);

  // The picture. three.js is fetched here, not with the page, so the first paint never waits on it.
  useEffect(() => {
    const cv = canvas.current;
    const p = pin.current;
    const host = root.current;
    if (!cv || !p || !host) return undefined;
    let stopped = false;
    let stop: (() => void) | undefined;
    void import("three")
      .then((T) => {
        if (stopped) return;
        stop = startStageScene({
          T,
          figures,
          model,
          strata,
          control: control.current,
          canvas: cv,
          pin: p,
          plateTags: plateTags.current.filter((t): t is HTMLElement => t !== null),
          ringTags: ringTags.current.filter((t): t is HTMLElement => t !== null),
          root: host,
          tip,
        });
        if (!stop) setNoGl(true);
      })
      .catch(() => setNoGl(true));
    return () => {
      stopped = true;
      stop?.();
    };
  }, [figures, model, strata, root, tip]);

  const phase = (i: number): string => `hv-phase${cur === i ? " on" : ""}`;

  return (
    <section className="hv-stage" id="stage" ref={stage} aria-label="How RepoHIVE builds the map">
      <div className="hv-pin" ref={pin}>
        <canvas
          className="hv-gl"
          ref={canvas}
          aria-label={`${figures.repository}'s files as hexagonal cells. Scrolling packs them into a hive, raises the kept regions, splits the hive into one plate per level, and turns the plates into the rings of the hierarchy.`}
        />
        <div className="hv-fallback" hidden={!noGl}>
          This picture needs WebGL. The story below still reads in full.
        </div>
        <div className="hv-over">
          <div className="hv-count" aria-hidden="true">
            <b>{counter[cur]![0]}</b>
            <span>{counter[cur]![1]}</span>
          </div>

          <div className={phase(0)} data-p="0">
            <h1 className="hv-hero-h">
              The <span>hive</span> inside your hairball.
            </h1>
            <p>Structure maps for Java repositories on GitHub.</p>
            <div className="hv-phase-form">
              <HiveIndexForm idPrefix="hero" idle="" />
            </div>
          </div>

          <div className={phase(1)} data-p="1">
            <h2>
              Every file gets <span>a cell.</span>
            </h2>
            <p>Files pack into a honeycomb, one patch per region.</p>
          </div>

          <div className={phase(2)} data-p="2">
            <h2>
              Keep what holds. <span>Rebuild the rest.</span>
            </h2>
            <div className="hv-legend">
              <div className="hv-split" role="img" aria-label="The regions kept, rebuilt and too small to measure, drawn in proportion">
                {split.map(([kind, n]) => (
                  <i key={kind} className={kind} style={{ flexGrow: n }} />
                ))}
              </div>
              {split.map(([kind, , word]) => (
                <span key={kind}>
                  <i className={`hv-sw ${kind}`} />
                  {word}
                </span>
              ))}
            </div>
          </div>

          <div className={phase(3)} data-p="3">
            <h2>
              Read it like <span>a core sample.</span>
            </h2>
            <p>One plate per level of the hierarchy.</p>
          </div>

          <div className={phase(4)} data-p="4">
            <h2>
              Your codebase, <span>in layers.</span>
            </h2>
            <a className="hv-btn hv-primary hv-lg" href="#explore">
              Explore the layers ↓
            </a>
          </div>

          {plateText.map((t, i) => (
            <div
              className="hv-plate-tag"
              key={t.head}
              ref={(el) => {
                plateTags.current[i] = el;
              }}
            >
              <b>{t.head}</b>
              {t.tail}
            </div>
          ))}
          {RING_LABELS.map((t, i) => (
            <div
              className="hv-strata-tag"
              key={t.head}
              ref={(el) => {
                ringTags.current[i] = el;
              }}
            >
              <b>{t.head}</b>
              {t.tail}
            </div>
          ))}

        </div>
      </div>
    </section>
  );
}
