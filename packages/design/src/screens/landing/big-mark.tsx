"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "./use-reduced-motion";

const QUADRANTS: readonly (readonly [number, number])[] = [
  [13, 1],
  [19, 1],
  [13, 7],
  [19, 7],
];

/** A seeded generator, so the pieces fly out the same way every time. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * The closing mark, large: three solid cells and one cell of sixty-four pieces. Hover or click and the pieces come apart
 * and settle again; it plays once when it scrolls into view. With reduced motion it stays still.
 */
export function BigMark() {
  const reduced = usePrefersReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const random = useRef(seeded(7));

  const rebuild = (): void => {
    const root = box.current;
    if (root === null || busy.current || reduced) return;
    busy.current = true;
    const tiles = Array.from(root.querySelectorAll<SVGRectElement>("rect[data-k]"));
    tiles.forEach((tile, index) => {
      const a = random.current() * Math.PI * 2;
      const d = 2 + random.current() * 5;
      tile.style.transitionDelay = `${(index % 16) * 8}ms`;
      tile.style.transform = `translate(${(Math.cos(a) * d).toFixed(2)}px,${(Math.sin(a) * d - 1).toFixed(2)}px) rotate(${((random.current() - 0.5) * 180).toFixed(0)}deg) scale(.55)`;
    });
    window.setTimeout(() => {
      tiles.forEach((tile) => {
        tile.style.transitionDelay = `${Number(tile.dataset.k) * 70 + Number(tile.dataset.m) * 12}ms`;
        tile.style.transform = "";
      });
    }, 620);
    window.setTimeout(() => {
      busy.current = false;
    }, 1900);
  };

  const play = useRef(rebuild);
  play.current = rebuild;
  useEffect(() => {
    const element = box.current;
    if (reduced || element === null || typeof IntersectionObserver === "undefined") return undefined;
    let timer = 0;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watcher.disconnect();
        timer = window.setTimeout(() => play.current(), 250);
      },
      { threshold: 0.6 },
    );
    watcher.observe(element);
    return () => {
      watcher.disconnect();
      window.clearTimeout(timer);
    };
  }, [reduced]);

  return (
    <div ref={box} className="rh-ld-big-mark" aria-hidden="true" onPointerEnter={rebuild} onClick={rebuild}>
      <svg viewBox="0 0 24 24">
        <rect className="rh-ld-ink" x="1" y="1" width="10" height="10" />
        <rect className="rh-ld-ink" x="1" y="13" width="10" height="10" />
        <rect className="rh-ld-ink" x="13" y="13" width="10" height="10" />
        {QUADRANTS.flatMap(([bx, by], k) =>
          Array.from({ length: 16 }, (_, m) => <rect key={`${k}-${m}`} className="rh-ld-tl" x={bx + (m % 4)} y={by + Math.floor(m / 4)} width="1.04" height="1.04" data-k={k} data-m={m} />),
        )}
      </svg>
    </div>
  );
}
