"use client";

import { useId, useState, type FormEvent } from "react";
import { Button, LinkButton } from "../../components/button";
import { Text } from "../../components/feedback";
import { Table, type TableColumn } from "../../components/table";
import { Brand } from "../../icons/mark";
import { routes } from "../../routes";
import { IndexRequestDialog, parseRepoInput } from "../dashboard/index-dialog";
import { BoundaryWhatIf } from "./boundary";
import type { LandingFigures } from "./figures-types";
import { FilmPlayer } from "./film-player";
import { ProofFigures, RegionWaffle } from "./proof";
import { Story } from "./story";

const number = new Intl.NumberFormat("en-US");
const percent = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;

/** The one-line index form the page shows twice. It checks what was typed and then opens the real request dialog. */
function IndexForm({ idPrefix }: { readonly idPrefix: string }) {
  const id = useId();
  const noteId = `${idPrefix}-note-${id}`;
  const [value, setValue] = useState("");
  const [note, setNote] = useState<{ readonly text: string; readonly error: boolean } | undefined>();
  const [dialogRepo, setDialogRepo] = useState<string | undefined>();

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (value.trim() === "") {
      setNote({ text: "Enter a repository, for example apache/kafka.", error: true });
      return;
    }
    const repo = parseRepoInput(value);
    if (repo === undefined) {
      setNote({ text: "Use owner/repo or a github.com link, for example apache/kafka.", error: true });
      return;
    }
    setNote({ text: `${repo} looks right.`, error: false });
    setDialogRepo(repo);
  };

  return (
    <>
      <form className="rh-ld-form" onSubmit={submit} noValidate>
        <input
          id={`${idPrefix}-repo-${id}`}
          className="rh-input rh-ld-input"
          placeholder="owner/repo or GitHub link"
          autoComplete="off"
          aria-label="Repository"
          aria-describedby={noteId}
          aria-invalid={note?.error === true ? true : undefined}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" variant="primary" size="lg">
          Index it
        </Button>
      </form>
      <p id={noteId} className={`rh-ld-note rh-t-caption ${note?.error === true ? "rh-ld-note-err" : "rh-fg3"}`} aria-live="polite">
        {note?.text}
      </p>
      <IndexRequestDialog open={dialogRepo !== undefined} initialRepo={dialogRepo} onClose={() => setDialogRepo(undefined)} />
    </>
  );
}

function ViewsBento({ figures }: { readonly figures: LandingFigures }) {
  const { counts, dsm, flat } = figures;
  const views: readonly { readonly name: string; readonly question: string; readonly figure: string }[] = [
    { name: "Overview", question: "What is in this repository, and how was it decided?", figure: `${number.format(counts.files)} files in ${number.format(counts.regions)} regions` },
    { name: "Map", question: "How is it nested, and who depends on whom?", figure: `${number.format(counts.groupNodes)} groups, ${counts.depth} levels deep` },
    { name: "Hierarchy", question: "Where do the files sit, level by level?", figure: `${counts.depth} rings, sweep is files` },
    { name: "Decisions", question: "Why was each package kept or rebuilt?", figure: `${number.format(counts.assessed)} measured regions, each with its score` },
    { name: "Architecture", question: "How do the groups depend on each other?", figure: `${number.format(dsm.totalGroups)} groups at level ${dsm.level}` },
    { name: "Baseline", question: "What did the flat graph look like before?", figure: `${number.format(counts.files)} files, ${number.format(flat.totalLinks)} imports` },
    { name: "Adaptivity", question: "How often does the engine keep a package?", figure: `${percent(counts.preserveShare)} kept, of measured` },
  ];
  return (
    <ul className="rh-ld-bento">
      {views.map((view) => (
        <li key={view.name} className="rh-panel rh-ld-view">
          <Text as="h3" role="heading">
            {view.name}
          </Text>
          <Text role="lead" tone="subtle">
            {view.question}
          </Text>
          <span className="rh-ld-code">{view.figure}</span>
        </li>
      ))}
    </ul>
  );
}

type DeterminismFile = LandingFigures["determinism"]["files"][number];

function Determinism({ figures }: { readonly figures: LandingFigures }) {
  const { determinism } = figures;
  const columns: TableColumn<DeterminismFile>[] = [
    { key: "name", header: "Index file", render: (file) => <span className="rh-mono">{file.name}</span> },
    { key: "bytes", header: "Size", numeric: true, render: (file) => `${number.format(file.bytes)} bytes` },
    { key: "sha", header: "SHA-256", render: (file) => <span className="rh-mono">{file.sha256.slice(0, 12)}…</span> },
  ];
  return (
    <div className="rh-ld-det">
      <div className="rh-ld-det-copy">
        <Text role="label">Determinism</Text>
        <Text as="h2" role="display">
          Same commit, same bytes.
        </Text>
        <Text role="lead" tone="subtle">
          Index the same commit twice and the index files match byte for byte, so a link to a region stays valid.
        </Text>
        <p className="rh-t-caption rh-fg3">
          Group ids are {determinism.groupScheme}. For example {determinism.sampleGroupId} names the same {number.format(determinism.sampleMembers)} members every time.
        </p>
      </div>
      <section className="rh-panel">
        <div className="rh-panel-head">
          <h3>The index of {figures.repository}</h3>
          <span className="rh-fg3 rh-mono">group digest {determinism.digest.slice(0, 8)}…</span>
        </div>
        <Table caption="The index files and their hashes" columns={columns} rows={determinism.files} rowKey={(file) => file.name} />
        <p className="rh-t-caption rh-fg3 rh-ld-det-note">The determinism check compares these hashes on every run.</p>
      </section>
    </div>
  );
}

/**
 * The landing page: the film, then the proof, how it works, the decisions, the views, determinism and the way in.
 * Everything it shows about a repository comes from `figures`, which a script writes from a real index.
 */
export function LandingScreen({ figures }: { readonly figures: LandingFigures }) {
  return (
    <div className="rh-ld" id="top">
      <header className="rh-ld-nav">
        <div className="rh-ld-wrap rh-ld-nav-row">
          <a className="rh-ld-brand" href="#top" aria-label="RepoHIVE, back to top">
            <Brand />
          </a>
          <nav className="rh-ld-links rh-hide-sm" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#boundary">Decisions</a>
            <a href="#views">Views</a>
            <a href="#same">Determinism</a>
          </nav>
          <div className="rh-ld-nav-right">
            <LinkButton variant="ghost" href={routes.signIn}>
              Sign in
            </LinkButton>
            <LinkButton variant="primary" href="#start" className="rh-hide-sm">
              Index a repository
            </LinkButton>
          </div>
        </div>
      </header>

      <section className="rh-ld-hero" aria-label="RepoHIVE">
        <div className="rh-ld-wrap rh-ld-hero-grid">
          <div className="rh-ld-hero-head">
            <Text role="label">Structure maps for Java repositories on GitHub</Text>
            <Text as="h1" role="hero">
              Read a codebase by the way it is actually built.
            </Text>
          </div>
          <FilmPlayer figures={figures} />
          <div className="rh-ld-hero-body">
            <Text role="lead" tone="subtle">
              RepoHIVE measures every package in a repository. Packages that hold together keep their shape. The rest are rebuilt from their dependencies. You get a map you can zoom into, and the
              reason behind every boundary.
            </Text>
            <IndexForm idPrefix="hero" />
            <p className="rh-ld-meta rh-t-caption rh-fg3">
              <span>Public repositories, with a daily allowance per account</span>
              <a href="#proof">See a real result →</a>
            </p>
          </div>
        </div>
      </section>

      <section className="rh-ld-sec" id="proof">
        <div className="rh-ld-wrap">
          <div className="rh-ld-sec-head">
            <Text role="label">One repository, every figure real</Text>
            <Text as="h2" role="display">
              {figures.repository}, start to finish.
            </Text>
            <Text role="lead" tone="subtle">
              An open-source commerce framework on Spring. Every number on this page, and every view behind it, comes from its index, read at {figures.signal.level}.
            </Text>
          </div>
          <ProofFigures figures={figures} />
          <RegionWaffle figures={figures} />
        </div>
      </section>

      <section className="rh-ld-sec" id="how">
        <div className="rh-ld-wrap">
          <div className="rh-ld-sec-head">
            <Text role="label">How it works</Text>
            <Text as="h2" role="display">
              From a flat graph to a map, one region at a time.
            </Text>
            <Text role="lead" tone="subtle">
              Scroll to run it. The picture is the same film, played by your position on the page.
            </Text>
          </div>
          <Story figures={figures} />
        </div>
      </section>

      <section className="rh-ld-sec" id="boundary">
        <div className="rh-ld-wrap">
          <div className="rh-ld-sec-head">
            <Text role="label">Decisions</Text>
            <Text as="h2" role="display">
              Every boundary comes with its reason.
            </Text>
            <Text role="lead" tone="subtle">
              These are {figures.repository}’s {number.format(figures.counts.assessed)} measured regions on one axis. Drag the line to see which decisions would change, or pick a region to see its values.
            </Text>
          </div>
          <BoundaryWhatIf figures={figures} />
        </div>
      </section>

      <section className="rh-ld-sec" id="views">
        <div className="rh-ld-wrap">
          <div className="rh-ld-sec-head">
            <Text role="label">Views</Text>
            <Text as="h2" role="display">
              Seven views of one index.
            </Text>
            <Text role="lead" tone="subtle">
              Each view answers one question about the same recorded result. The figures below are {figures.repository}’s.
            </Text>
          </div>
          <ViewsBento figures={figures} />
        </div>
      </section>

      <section className="rh-ld-sec" id="same">
        <div className="rh-ld-wrap">
          <Determinism figures={figures} />
        </div>
      </section>

      <section className="rh-ld-end" id="start">
        <div className="rh-ld-wrap rh-ld-end-copy">
          <Text role="label">Start</Text>
          <Text as="h2" role="display">
            Index your first repository.
          </Text>
          <Text role="lead" tone="subtle">
            Paste a public GitHub repository. RepoHIVE checks it, indexes it, and opens the map when it is done.
          </Text>
          <IndexForm idPrefix="end" />
        </div>
      </section>

      <footer className="rh-ld-foot">
        <div className="rh-ld-wrap rh-ld-foot-row rh-t-caption">
          <a className="rh-ld-brand" href="#top">
            <Brand markSize={16} />
          </a>
          <a href="#how">How it works</a>
          <a href="#boundary">Decisions</a>
          <a href="#views">Views</a>
          <a href="#same">Determinism</a>
          <a href={routes.method}>Method</a>
        </div>
      </footer>
    </div>
  );
}
