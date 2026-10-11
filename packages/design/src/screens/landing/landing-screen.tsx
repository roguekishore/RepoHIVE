"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LinkButton } from "../../components/button";
import { Text } from "../../components/feedback";
import { Brand } from "../../icons/mark";
import { routes } from "../../routes";
import { BigMark } from "./big-mark";
import { BoundaryWhatIf } from "./boundary";
import { Determinism } from "./determinism";
import type { LandingFigures } from "./figures-types";
import { FilmPlayer } from "./film-player";
import { IndexForm } from "./index-form";
import { ProofFigures, RegionWaffle } from "./proof";
import { Story } from "./story";
import { ViewsBento } from "./views-bento";

const number = new Intl.NumberFormat("en-US");

const HEADLINE = "Read a codebase by the way it is actually built.";

/** A section head: the label across the top, then the title and the lead side by side. */
function SectionHead({ label, title, children }: { readonly label: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="rh-ld-sec-head">
      <span className="rh-t-label">{label}</span>
      <Text as="h2" role="display">
        {title}
      </Text>
      <p className="rh-t-lead">{children}</p>
    </div>
  );
}

/**
 * The landing page: the film, then the proof, how it works, the decisions, the views, determinism and the way in.
 * Everything it shows about a repository comes from `figures`, which a script writes from a real index.
 */
export function LandingScreen({ figures }: { readonly figures: LandingFigures }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="rh-ld" id="top">
      <header className={scrolled ? "rh-ld-nav rh-ld-scrolled" : "rh-ld-nav"}>
        <div className="rh-ld-wrap rh-ld-nav-row">
          <a className="rh-ld-brand" href="#top" aria-label="RepoHIVE, back to top">
            <Brand />
          </a>
          <nav className="rh-ld-links" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#boundary">Decisions</a>
            <a href="#views">Views</a>
            <a href="#same">Determinism</a>
          </nav>
          <div className="rh-ld-nav-right">
            <LinkButton variant="ghost" href={routes.signIn}>
              Sign in
            </LinkButton>
            <LinkButton variant="primary" href="#start">
              Index a repository
            </LinkButton>
          </div>
        </div>
      </header>

      <main>
        <section className="rh-ld-hero" aria-label="RepoHIVE">
          <div className="rh-ld-wrap rh-ld-hero-grid">
            <div className="rh-ld-hero-head">
              <span className="rh-t-label">Structure maps for Java repositories on GitHub</span>
              <h1 className="rh-t-hero" aria-label={HEADLINE}>
                <span aria-hidden="true">
                  {HEADLINE.split(" ").map((word, index, words) => (
                    <span key={index}>
                      <span className="rh-ld-w" style={{ "--i": index } as React.CSSProperties}>
                        <span>{word}</span>
                      </span>
                      {index < words.length - 1 ? " " : null}
                    </span>
                  ))}
                </span>
              </h1>
            </div>
            <FilmPlayer figures={figures} />
            <div className="rh-ld-hero-body">
              <p className="rh-t-lead rh-ld-lead">
                RepoHIVE measures every package in a repository. Packages that hold together keep their shape. The rest are rebuilt from their dependencies. You get a map you can zoom into, and the
                reason behind every boundary.
              </p>
              <IndexForm idPrefix="hero" />
              <div className="rh-ld-meta">
                <span>Public repositories, with a daily allowance per account</span>
                <a href="#proof">
                  See a real result <span aria-hidden="true">→</span>
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="rh-ld-sec" id="proof">
          <div className="rh-ld-wrap">
            <SectionHead label="One repository, every figure real" title={`${figures.repository}, start to finish.`}>
              An open-source commerce framework on Spring. Every number on this page, and every view behind it, comes from its index, read at {figures.signal.level}.
            </SectionHead>
            <ProofFigures figures={figures} />
            <RegionWaffle figures={figures} />
          </div>
        </section>

        <section className="rh-ld-sec" id="how">
          <div className="rh-ld-wrap">
            <SectionHead label="How it works" title="From a flat graph to a map, one region at a time.">
              Scroll to run it. The picture is the same film, played by your position on the page.
            </SectionHead>
            <Story figures={figures} />
          </div>
        </section>

        <section className="rh-ld-sec" id="boundary">
          <div className="rh-ld-wrap">
            <SectionHead label="Decisions" title="Every boundary comes with its reason.">
              These are {figures.repository}’s {number.format(figures.counts.assessed)} measured regions on one axis. Drag the line to see which decisions would change, or pick a region to see its
              values.
            </SectionHead>
            <BoundaryWhatIf figures={figures} />
          </div>
        </section>

        <section className="rh-ld-sec" id="views">
          <div className="rh-ld-wrap">
            <SectionHead label="Views" title="Seven views of one index.">
              Each view answers one question about the same recorded result. Every preview below is drawn from {figures.repository}’s index.
            </SectionHead>
            <ViewsBento figures={figures} />
          </div>
        </section>

        <section className="rh-ld-sec" id="same">
          <Determinism figures={figures} />
        </section>

        <section className="rh-ld-end" id="start">
          <div className="rh-ld-wrap rh-ld-end-grid">
            <BigMark />
            <div className="rh-ld-end-copy">
              <span className="rh-t-label">Start</span>
              <Text as="h2" role="display">
                Index your first repository.
              </Text>
              <p className="rh-t-lead">Paste a public GitHub repository. RepoHIVE checks it, indexes it, and opens the map when it is done.</p>
              <IndexForm idPrefix="end" arrow />
            </div>
          </div>
        </section>
      </main>

      <footer className="rh-ld-foot">
        <div className="rh-ld-wrap rh-ld-foot-row">
          <a className="rh-ld-brand" href="#top">
            <Brand markSize={16} />
          </a>
          <a href="#how">How it works</a>
          <a href="#boundary">Decisions</a>
          <a href="#views">Views</a>
          <a href="#same">Determinism</a>
          <span className="rh-ld-foot-year">© {new Date().getFullYear()} RepoHIVE</span>
        </div>
      </footer>
    </div>
  );
}
