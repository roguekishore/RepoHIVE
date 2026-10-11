"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLink } from "../../provider/design-provider";
import { routes } from "../../routes";
import { useHive } from "./context";
import { clamp, number } from "./model";
import { prefersReducedMotion, readScopedPalette, watchScopedPalette } from "./palette";
import { paintThumb, VIEWS, type ViewId } from "./thumbs";

/** The fixed nav's height in pixels; the same value as `--rh-hv-nav`. */
const NAV = 64;

/** The overview preview is markup, not a canvas: the repository in figures and its five largest regions. */
function Overview() {
  const { figures } = useHive();
  const c = figures.counts;
  const share = ((c.preserved / c.assessed) * 100).toFixed(1);
  const top = figures.regions
    .slice()
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const mx = top[0]?.[1] ?? 1;
  return (
    <div className="hv-ov">
      <div className="hv-ov-figs">
        <div>
          <b>{number.format(c.files)}</b>
          <span>files</span>
        </div>
        <div>
          <b>{number.format(c.regions)}</b>
          <span>regions</span>
        </div>
        <div>
          <b>{share}%</b>
          <span>kept, of measured</span>
        </div>
      </div>
      <div className="hv-ov-bars">
        {top.map((r) => {
          const w = Math.max(6, (r[1] / mx) * 62);
          return (
            <div key={r[0]}>
              <em className={r[5] === 1 ? "k" : "r"} style={{ "--w": `${w}%` } as CSSProperties}>
                <i style={{ width: `${w}%` }} />
                <span>{r[0]}</span>
              </em>
              <b>{number.format(r[1])}</b>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One view's preview: a canvas that repaints on resize and on a theme change. */
function Thumb({ id }: { readonly id: ViewId }) {
  const { figures, root } = useHive();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (id === "overview") return undefined;
    const el = box.current;
    const cv = canvas.current;
    const host = root.current;
    if (!el || !cv || !host) return undefined;
    let palette = readScopedPalette(host);
    // A preview is painted when it is within a screen of the viewport, and again only if its size or the theme changed
    // while it was away; painting all six at load is main-thread work nobody can see.
    let near = typeof IntersectionObserver !== "function";
    let stale = true;
    const paint = (): void => {
      stale = true;
      if (!near) return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || !palette) return;
      const d = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(r.width * d);
      const h = Math.round(r.height * d);
      // Assigning a size clears the canvas and drops its backing store, so only do it when the size changed.
      if (cv.width !== w) cv.width = w;
      if (cv.height !== h) cv.height = h;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      paintThumb(id, ctx, r.width, r.height, palette, figures);
      stale = false;
    };
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              near = entries.some((e) => e.isIntersecting);
              if (near && stale) paint();
            },
            { rootMargin: "100% 0px" },
          )
        : undefined;
    io?.observe(el);
    // Observing a size reports it once straight away, which is the first paint.
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(paint) : undefined;
    ro?.observe(el);
    if (!ro) paint();
    const stop = watchScopedPalette(host, (next) => {
      palette = next;
      paint();
    });
    return () => {
      io?.disconnect();
      ro?.disconnect();
      stop();
    };
  }, [id, figures, root]);

  return (
    <div className="hv-thumb" ref={box}>
      {id === "overview" ? <Overview /> : <canvas ref={canvas} aria-hidden="true" />}
    </div>
  );
}

/**
 * The seven views as strata: a pile of screens, each lifted off the stack as the page scrolls. On a narrow screen or with
 * reduced motion the pile lies flat as a grid, with each view's sentence beside its preview.
 */
export function HiveDeck() {
  const Link = useLink();
  const { figures } = useHive();
  const deck = useRef<HTMLDivElement>(null);
  const layers = useRef<(HTMLDivElement | null)[]>([]);
  const [flat, setFlat] = useState(false);
  const [cur, setCur] = useState(0);
  const flatRef = useRef(false);
  const target = useRef(0);
  const curRef = useRef(-1);

  useEffect(() => {
    const decide = (): void => {
      const next = prefersReducedMotion() || window.innerWidth < 900;
      flatRef.current = next;
      setFlat(next);
    };
    decide();
    window.addEventListener("resize", decide);
    return () => window.removeEventListener("resize", decide);
  }, []);

  useEffect(() => {
    const el = deck.current;
    if (!el) return undefined;
    // Measured when the layout changes, so a scroll event never forces a layout.
    let top = 0;
    let span = 1;
    const measure = (): void => {
      span = Math.max(1, el.offsetHeight - (window.innerHeight - NAV));
      top = el.getBoundingClientRect().top + window.scrollY;
    };
    const readDeck = (): void => {
      if (flatRef.current) return;
      target.current = clamp((window.scrollY + NAV - top) / span, 0, 1) * (VIEWS.length - 1);
      kick();
    };
    const place = (a: number): void => {
      layers.current.forEach((layer, i) => {
        if (!layer) return;
        const d = i - a;
        let tf: string;
        let op = 1;
        let z: number;
        if (d < 0) {
          const t = Math.min(1, -d);
          tf = `translate3d(0, ${-t * 70}%, 0) rotateX(${-t * 8}deg) scale(${1 - t * 0.04})`;
          op = 1 - t;
          z = 200;
        } else {
          const k = Math.min(1, d);
          const far = Math.max(0, d - 1);
          tf = `translate3d(${k * 3}%, ${k * 52 + far * 9}%, ${-k * 60 - far * 40}px) rotateX(${k * 58}deg) rotateZ(${-k * 34}deg) scale(${1 - k * 0.2})`;
          op = d > 4.5 ? Math.max(0, 5.5 - d) : 1;
          z = 100 - Math.round(d * 10);
        }
        layer.style.transform = tf;
        layer.style.opacity = String(op);
        layer.style.zIndex = String(z);
      });
      const k = Math.round(a);
      if (k !== curRef.current) {
        curRef.current = k;
        setCur(k);
      }
    };
    // The deck eases on its own small loop, so it runs even where WebGL does not. The loop stops once it has arrived and
    // the next scroll starts it again.
    let shown = 0;
    let raf = 0;
    const loop = (): void => {
      raf = 0;
      if (flatRef.current) return;
      shown += (target.current - shown) * (prefersReducedMotion() ? 1 : 0.12);
      const moving = Math.abs(target.current - shown) > 0.0005;
      if (moving || curRef.current < 0) place(shown);
      if (moving) raf = requestAnimationFrame(loop);
    };
    function kick(): void {
      if (raf === 0) raf = requestAnimationFrame(loop);
    }
    const remeasure = (): void => {
      measure();
      readDeck();
    };
    place(0);
    window.addEventListener("scroll", readDeck, { passive: true });
    window.addEventListener("resize", remeasure);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(remeasure) : undefined;
    ro?.observe(el);
    // A section above changing height moves this one without resizing it.
    ro?.observe(document.body);
    remeasure();
    kick();
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("scroll", readDeck);
      window.removeEventListener("resize", remeasure);
    };
  }, []);

  const lift = (i: number): void => {
    const el = deck.current;
    if (!el) return;
    const span = el.offsetHeight - (window.innerHeight - NAV);
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top - NAV + (span * i) / (VIEWS.length - 1) + 2, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  const now = VIEWS[cur] ?? VIEWS[0]!;
  return (
    <div className={flat ? "hv-deck hv-flat" : "hv-deck"} ref={deck}>
      <div className="hv-deck-pin">
        <div className="hv-wrap hv-deck-grid">
          <div className="hv-deck-copy">
            <ul className="hv-deck-list">
              {VIEWS.map((v, i) => (
                <li key={v.id}>
                  <button type="button" className={i === cur ? "on" : undefined} onClick={() => lift(i)}>
                    <i />
                    {v.name}
                  </button>
                </li>
              ))}
            </ul>
            <p className="hv-deck-now" aria-live="polite">
              {now.text}
            </p>
            <div className="hv-deck-cta">
              <Link className="hv-btn" href={routes.repos}>
                Explore repositories →
              </Link>
            </div>
          </div>
          <div className="hv-deck-stack">
            {VIEWS.map((v, i) => (
              <div
                className="hv-layer"
                key={v.id}
                ref={(el) => {
                  layers.current[i] = el;
                }}
              >
                <div className="hv-layer-in">
                  <div className="hv-layer-bar">
                    <b>{v.name}</b>
                    <span>{figures.repository}</span>
                  </div>
                  <p className="hv-layer-txt">{v.text}</p>
                  <Thumb id={v.id} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
