"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../../icons/icons";
import { Mark } from "../../icons/mark";
import { useLink } from "../../provider/design-provider";
import { routes } from "../../routes";
import { useTheme } from "../../theme/theme";
import { IndexRequestDialog } from "../dashboard/index-dialog";
import type { LandingFigures } from "../landing/figures-types";
import { HiveContext, type HiveContextValue, type TipApi } from "./context";
import { HiveDeck } from "./deck";
import { HiveExplorer } from "./explorer";
import { HiveIndexForm } from "./form";
import { buildHiveModel, buildStrata } from "./model";
import { HiveStage } from "./stage";

function Brand() {
  return (
    <a className="hv-brand" href="#top" aria-label="RepoHIVE, back to top">
      <Mark size={20} />
      RepoHIVE
    </a>
  );
}

/** The theme a `system` preference currently resolves to, following the operating system's setting. */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (): void => setDark(query.matches);
    on();
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, []);
  return dark;
}

/** Flips between light and dark. From `system` it flips away from whatever the system is showing. */
function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const systemDark = useSystemDark();
  const dark = preference === "system" ? systemDark : preference === "dark";
  return (
    <button type="button" className="hv-btn hv-icon" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setPreference(dark ? "light" : "dark")}>
      <Icon name={dark ? "sun" : "moon"} size={16} />
    </button>
  );
}

function Nav() {
  const Link = useLink();
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = (): void => setSolid(window.scrollY > 8);
    window.addEventListener("scroll", on, { passive: true });
    on();
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={solid ? "hv-nav hv-solid" : "hv-nav"}>
      <div className="hv-wrap hv-nav-row">
        <Brand />
        <div className="hv-nav-right">
          <ThemeToggle />
          <Link className="hv-btn hv-ghost hv-icon" href={routes.signIn} aria-label="Sign in">
            <Icon name="user" size={16} />
          </Link>
          <Link className="hv-btn" href={routes.repos}>
            Explore
          </Link>
          <a className="hv-btn hv-primary" href="#start">
            Index
          </a>
        </div>
      </div>
    </header>
  );
}

/** A section's heading: one line that says what the section shows, and one short line under it. */
function SecHead({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="hv-sec-head">
      <h2>{title}</h2>
      <p className="hv-lead">{children}</p>
    </div>
  );
}

/**
 * The landing page, in the Hive Core design: a pinned animation that turns a repository's files into a hive and the
 * hive into the rings of its hierarchy, an explorer for those rings, the seven views as a lifted stack
 * and the way in. Every figure comes from `figures`. The colours are the product's own tokens (Ultraviolet); `.rh-hv` scopes only the landing's type scale and layout.
 */
export function HiveLanding({ figures }: { readonly figures: LandingFigures }) {
  const Link = useLink();
  const root = useRef<HTMLDivElement>(null);
  const tipEl = useRef<HTMLDivElement>(null);
  const [dialogRepo, setDialogRepo] = useState<string | undefined>();

  const model = useMemo(() => buildHiveModel(figures), [figures]);
  const strata = useMemo(() => buildStrata(figures), [figures]);

  const tip = useMemo<TipApi>(() => {
    let owner = "";
    let key = "";
    return {
      show(by, [before, bold, after], clientX, clientY) {
        const el = tipEl.current;
        if (!el) return;
        owner = by;
        const next = `${before}|${bold}|${after}`;
        if (next !== key) {
          key = next;
          const b = document.createElement("b");
          b.textContent = bold;
          el.replaceChildren(document.createTextNode(before), b, document.createTextNode(after));
        }
        el.style.left = `${clientX}px`;
        el.style.top = `${clientY}px`;
        el.classList.add("on");
      },
      hide(by) {
        if (owner !== by) return;
        owner = "";
        key = "";
        tipEl.current?.classList.remove("on");
      },
    };
  }, []);

  const value = useMemo<HiveContextValue>(() => ({ figures, model, strata, root, tip, requestIndex: setDialogRepo }), [figures, model, strata, tip]);
  return (
    <HiveContext.Provider value={value}>
      <div className="rh-hv hv" ref={root} id="top">
        <Nav />

        <div>
          <HiveStage />

          <section className="hv-sec" id="explore">
            <div className="hv-wrap">
              <SecHead title="Every level, one piece at a time.">
                Turn it, pull the levels apart, click a piece to follow its branch.
              </SecHead>
              <HiveExplorer />
            </div>
          </section>

          <section className="hv-sec" id="views">
            <div className="hv-wrap">
              <SecHead title="Seven views of one index.">Each answers one question about the same index.</SecHead>
            </div>
            <HiveDeck />
          </section>

          <section className="hv-end" id="start">
            <div className="hv-wrap hv-end-in">
              <h2>
                Find the hive <span className="hv-acc">in yours.</span>
              </h2>
              <HiveIndexForm idPrefix="end" idle="Public Java repositories on GitHub." />
            </div>
          </section>
        </div>

        <footer className="hv-foot">
          <div className="hv-wrap hv-foot-row">
            <Brand />
            <Link href={routes.repos}>Repositories</Link>
          </div>
        </footer>

        <div className="hv-tip" ref={tipEl} aria-hidden="true" />
        <IndexRequestDialog open={dialogRepo !== undefined} initialRepo={dialogRepo} onClose={() => setDialogRepo(undefined)} />
      </div>
    </HiveContext.Provider>
  );
}
