"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LinkButton } from "../../components/button";
import { Text } from "../../components/feedback";
import { Icon } from "../../icons/icons";
import { Brand } from "../../icons/mark";
import { useLink } from "../../provider/design-provider";
import { routes } from "../../routes";
import { BigMark } from "./big-mark";
import { BoundaryWhatIf } from "./boundary";
import type { LandingFigures } from "./figures-types";
import { FilmPlayer } from "./film-player";
import { IndexForm } from "./index-form";
import { Story } from "./story";
import { ViewsBento } from "./views-bento";

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

/** A text link to the public repository list, which anyone can read without an account. */
function ExploreLink({ children, arrow = true }: { readonly children: ReactNode; readonly arrow?: boolean }) {
  const Link = useLink();
  return (
    <Link className="rh-ld-explore" href={routes.repos}>
      {children}
      {arrow ? <span aria-hidden="true"> →</span> : null}
    </Link>
  );
}

/**
 * The landing page: the film, then how it works, the decisions, the views and the way in.
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
          </nav>
          <div className="rh-ld-nav-right">
            <LinkButton variant="ghost" href={routes.signIn}>
              Sign in
            </LinkButton>
            <LinkButton href={routes.repos}>
              <Icon name="repo" size={16} />
              Explore<span className="rh-ld-explore-long"> repositories</span>
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
                <a href="#how">
                  See how it works <span aria-hidden="true">→</span>
                </a>
              </div>
              <ExploreLink>Explore the indexed repositories, free and with no account</ExploreLink>
            </div>
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
              Every measured region sits on one axis. Drag the line to see which decisions would change, or pick a region to see its
              values.
            </SectionHead>
            <BoundaryWhatIf figures={figures} />
          </div>
        </section>

        <section className="rh-ld-sec" id="views">
          <div className="rh-ld-wrap">
            <SectionHead label="Views" title="Seven views of one index.">
              Each view answers one question about the same recorded result. The previews below are illustrations of each view.
            </SectionHead>
            <ViewsBento figures={figures} />
            <div className="rh-ld-views-cta">
              <p>Every indexed repository opens in all seven views. Reading them needs no account.</p>
              <LinkButton href={routes.repos}>
                Explore repositories
                <Icon name="arrow" size={16} className="rh-ld-arrow" />
              </LinkButton>
            </div>
          </div>
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
              <ExploreLink>Or explore the repositories already indexed</ExploreLink>
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
          <ExploreLink arrow={false}>Repositories</ExploreLink>
          <span className="rh-ld-foot-year">© {new Date().getFullYear()} RepoHIVE</span>
        </div>
      </footer>
    </div>
  );
}
