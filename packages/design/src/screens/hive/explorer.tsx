"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useHive } from "./context";
import { startExplorerScene, type ExplorerHandle } from "./explorer-scene";
import { READOUT_HINT, readoutFor, ringLabels, type Readout } from "./model";

const LEVELS = [
  { level: 0, label: "All" },
  { level: 1, label: "1" },
  { level: 2, label: "2" },
  { level: 3, label: "3" },
  { level: 4, label: "4" },
] as const;

/** Camera elevations, in radians: looking down, three-quarter, side on. */
const VIEW_PRESETS = [
  { elevation: 1.42, label: "Above" },
  { elevation: 0.6, label: "Angle" },
  { elevation: 0.14, label: "Side" },
] as const;

const DEFAULT_ELEVATION = 0.6;

/**
 * The hierarchy as an object to turn over: one ring per level. The visitor can pull the levels apart, stand one level
 * alone, change the angle, and click a piece to light its branch from the repository down.
 */
export function HiveExplorer() {
  const { figures, strata, root, tip } = useHive();
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tags = useRef<(HTMLElement | null)[]>([]);
  const handle = useRef<ExplorerHandle | undefined>(undefined);
  const inView = useRef(false);
  const [noGl, setNoGl] = useState(false);
  // The scene is built when the explorer is within a screen or so of the viewport, not with the page: it is far below
  // the fold, and building it competes with the first seconds of the animation above it.
  const [near, setNear] = useState(typeof IntersectionObserver !== "function");
  const [spread, setSpread] = useState(100);
  const [level, setLevel] = useState(0);
  const [view, setView] = useState<number | null>(DEFAULT_ELEVATION);
  const [readout, setReadout] = useState<Readout>(() => readoutFor(figures, strata, -1, false, 0));

  const labels = useMemo(() => ringLabels(figures, strata), [figures, strata]);

  useEffect(() => {
    const cv = canvas.current;
    const box = stage.current;
    const host = root.current;
    if (!near || !cv || !box || !host) return undefined;
    let stopped = false;
    let stop: (() => void) | undefined;
    void import("three")
      .then((T) => {
        if (stopped) return;
        const started = startExplorerScene({
          T,
          figures,
          strata,
          canvas: cv,
          stage: box,
          tags: tags.current.filter((t): t is HTMLElement => t !== null),
          root: host,
          tip,
          onRead: setReadout,
          onFreeView: () => setView(null),
        });
        if (!started) {
          setNoGl(true);
          return;
        }
        handle.current = started.handle;
        started.handle.setInView(inView.current);
        stop = started.stop;
      })
      .catch(() => setNoGl(true));
    return () => {
      stopped = true;
      stop?.();
      handle.current = undefined;
    };
  }, [near, figures, strata, root, tip]);

  useEffect(() => {
    const box = stage.current;
    if (near || !box || typeof IntersectionObserver !== "function") return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "100% 0px" },
    );
    io.observe(box);
    return () => io.disconnect();
  }, [near]);

  // The scene only draws while it is on screen.
  useEffect(() => {
    const box = stage.current;
    if (!box) return undefined;
    if (typeof IntersectionObserver !== "function") {
      inView.current = true;
      handle.current?.setInView(true);
      return undefined;
    }
    const io = new IntersectionObserver((entries) => {
      const on = entries.some((e) => e.isIntersecting);
      inView.current = on;
      handle.current?.setInView(on);
    });
    io.observe(box);
    return () => io.disconnect();
  }, []);

  const reset = (): void => {
    setSpread(100);
    setLevel(0);
    setView(DEFAULT_ELEVATION);
    handle.current?.reset();
  };

  return (
    <div className="hv-xp">
      <div className="hv-xp-stage" ref={stage}>
        <canvas
          className="hv-xp-gl"
          ref={canvas}
          tabIndex={0}
          aria-label={`Explorable 3D model of ${figures.repository}'s hierarchy. Drag or use the arrow keys to turn it; click a piece to select it.`}
          aria-describedby="xp-keys"
        />
        <div className="hv-fallback" hidden={!noGl}>
          This explorer needs WebGL.
        </div>
        <div className="hv-xp-over">
          {labels.map((t, i) => (
            <div
              className="hv-strata-tag"
              key={t.before}
              ref={(el) => {
                tags.current[i] = el;
              }}
            >
              {t.before}
              <b>{t.count}</b>
              {t.after}
            </div>
          ))}
        </div>
        <p className="hv-xp-hint" id="xp-keys">
          Drag to turn · Arrow keys to turn and tilt · Click a piece
        </p>
        <div className="hv-xp-zoom">
          <button type="button" aria-label="Zoom in" onClick={() => handle.current?.zoomBy(0.85)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => handle.current?.zoomBy(1 / 0.85)}>
            −
          </button>
        </div>
      </div>

      <aside className="hv-xp-side" aria-label="Explorer controls">
        <div className="hv-xp-panel hv-xp-ctl">
          <div className="hv-xp-row">
            <label className="hv-label" htmlFor="xp-spread">
              Spread
            </label>
            <input
              type="range"
              id="xp-spread"
              min={0}
              max={100}
              value={spread}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSpread(v);
                handle.current?.setSpread(v / 100);
              }}
            />
            <div className="hv-xp-ends">
              <span>Together</span>
              <span>Apart</span>
            </div>
          </div>
          <div className="hv-xp-row">
            <span className="hv-label" id="xp-lv-l">
              Level
            </span>
            <div className="hv-seg" role="group" aria-labelledby="xp-lv-l">
              {LEVELS.map((l) => (
                <button
                  type="button"
                  key={l.level}
                  aria-pressed={level === l.level}
                  onClick={() => {
                    setLevel(l.level);
                    handle.current?.setLevel(l.level);
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <div className="hv-xp-row">
            <span className="hv-label" id="xp-vw-l">
              View
            </span>
            <div className="hv-seg" role="group" aria-labelledby="xp-vw-l">
              {VIEW_PRESETS.map((v) => (
                <button
                  type="button"
                  key={v.label}
                  aria-pressed={view === v.elevation}
                  onClick={() => {
                    setView(v.elevation);
                    handle.current?.setElevation(v.elevation);
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="hv-btn" onClick={reset}>
            Reset
          </button>
        </div>

        <div className="hv-xp-panel hv-xp-read" aria-live="polite">
          <span className="hv-label">{readout.level}</span>
          <div className="hv-rd-big">
            <b>{readout.files}</b>
            <span>files</span>
          </div>
          <span className="hv-rd-tag">
            <i className={`hv-sw ${readout.swatch}`} />
            {readout.tag}
          </span>
          <dl className="hv-rd-dl">
            <div>
              <dt>Share</dt>
              <dd>{readout.share}</dd>
            </div>
            <div>
              <dt>Inside</dt>
              <dd>{readout.inside}</dd>
            </div>
            <div>
              <dt>Below it</dt>
              <dd>{readout.below}</dd>
            </div>
          </dl>
          <p className="hv-rd-hint">{readout.hint || READOUT_HINT}</p>
        </div>

        <div className="hv-xp-panel hv-xp-legend">
          <span>
            <i className="hv-sw k" />
            Kept as written
          </span>
          <span>
            <i className="hv-sw r" />
            Rebuilt from dependencies
          </span>
          <span>
            <i className="hv-sw u" />
            Too small to measure
          </span>
          <span>
            <i className="hv-sw g" />
            Group
          </span>
        </div>
      </aside>
    </div>
  );
}
