"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { Text } from "../../components/feedback";
import type { LandingFigures } from "./figures-types";

const HOLDS: Readonly<Record<string, string>> = {
  "repository.json": "Summary and counts",
  "hierarchy.json": "Every node id, once, and the tree",
  "nodes.json": "Region and package of each node",
  "edges.json": "File dependencies and their weights",
  "metadata.json": "Every region decision and its numbers",
};

const number = new Intl.NumberFormat("en-US");

/**
 * The determinism section: what the five index files hold and their recorded hashes. The hashes come from the committed
 * index. A claim that two runs matched is shown only for a comparison that was recorded, and none is in these figures.
 */
export function Determinism({ figures }: { readonly figures: LandingFigures }) {
  const { determinism, settings } = figures;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = panel.current;
    if (element === null || typeof IntersectionObserver === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watcher.disconnect();
        element.classList.add("rh-ld-go");
      },
      { threshold: 0.5 },
    );
    watcher.observe(element);
    return () => watcher.disconnect();
  }, []);

  return (
    <div className="rh-ld-wrap rh-ld-det">
      <div className="rh-ld-det-copy">
        <span className="rh-t-label">Determinism</span>
        <Text as="h2" role="display">
          Same commit, same bytes.
        </Text>
        <p className="rh-t-lead">Index the same commit twice and the five index files match byte for byte, so a link to a region stays valid.</p>
        <dl className="rh-ld-kv">
          <dt>Group id</dt>
          <dd>{determinism.groupScheme}</dd>
          <dt>Example</dt>
          <dd>
            {determinism.sampleGroupId.slice(0, 20)}… · {number.format(determinism.sampleMembers)} members
          </dd>
          <dt>Seed</dt>
          <dd>{settings.seed}</dd>
          <dt>Group digest</dt>
          <dd>{determinism.digest.slice(0, 8)}…</dd>
        </dl>
      </div>
      <section ref={panel} className="rh-panel rh-ld-det-run">
        <header className="rh-panel-head">
          <h3>The index of {figures.repository}</h3>
          <span className="rh-fg3 rh-mono">group digest {determinism.digest.slice(0, 8)}…</span>
        </header>
        <div className="rh-ld-tbl-wrap">
          <table className="rh-ld-tbl" aria-label="The index files and their hashes">
            <thead>
              <tr>
                <th>Index file</th>
                <th>Holds</th>
                <th>SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {determinism.files.map((file, index) => (
                <tr key={file.name} style={{ "--r": index } as CSSProperties}>
                  <td className="rh-ld-m">{file.name}</td>
                  <td className="rh-fg2">{HOLDS[file.name] ?? ""}</td>
                  <td className="rh-ld-m">{file.sha256.slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
