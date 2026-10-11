"use client";

import { Text } from "../../components/feedback";

const SECTIONS = [
  { id: "m-regions", label: "Regions" },
  { id: "m-score", label: "Scoring a region" },
  { id: "m-decide", label: "Kept or rebuilt" },
  { id: "m-small", label: "Regions too small to measure" },
  { id: "m-same", label: "Same input, same output" },
  { id: "m-views", label: "The views" },
] as const;

const VIEWS: readonly { readonly name: string; readonly about: string }[] = [
  { name: "Overview", about: "the repository in figures, and its largest regions." },
  { name: "Map", about: "the hierarchy as nested cards you zoom into." },
  { name: "Hierarchy", about: "every level at once; radius is depth, sweep is files." },
  { name: "Decisions", about: "each region's score, the boundary, and the values behind the decision." },
  { name: "Architecture", about: "level sizes, dependencies between groups, how far packages were split." },
  { name: "Baseline", about: "the flat file graph before any hierarchy, for comparison." },
  { name: "Adaptivity", about: "how many regions were kept, and how scores are spread." },
];

/** Scrolls to a section; the browser's own jump when the user prefers reduced motion. */
function jumpTo(id: string): void {
  const target = document.getElementById(id);
  if (target === null) return;
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

/**
 * The Method page: how a hierarchy is built, written once. It states the rules, not any repository's figures; the
 * numbers a snapshot recorded are on its Decisions and Adaptivity pages, which this page points to.
 */
export function MethodScreen() {
  return (
    <div className="rh-doc">
      <article>
        <header className="rh-doc-head">
          <Text role="label">Method</Text>
          <Text as="h1" role="display">
            How RepoHIVE builds a hierarchy
          </Text>
          <p className="rh-t-lead">
            RepoHIVE reads a repository&rsquo;s source files and the dependencies between them, then decides for each package whether to keep it as written or rebuild it from those dependencies.
            Every decision is recorded with the numbers behind it.
          </p>
        </header>

        <h2 className="rh-t-title" id="m-regions">
          Regions
        </h2>
        <p>
          Every package the authors wrote is a <strong>region</strong>. Regions are judged one at a time, so a well-organised part of a codebase can be kept while a tangled part next to it is
          rebuilt.
        </p>

        <h2 className="rh-t-title" id="m-score">
          Scoring a region
        </h2>
        <p>
          Two measurements go into a region&rsquo;s score. <strong>Cohesion</strong> is how strongly the region&rsquo;s files depend on each other. <strong>Coupling</strong> is how much of their
          dependency weight leaves the region. Cohesion is squashed into the range 0 to 1, coupling is turned into independence, and the score is their weighted mean.
        </p>
        <div className="rh-doc-formula">
          <div>squash(c) = c / (c + k)</div>
          <div>independence = 1 − coupling</div>
          <div>score = (w₁ × squash(cohesion) + w₂ × independence) / (w₁ + w₂)</div>
        </div>
        <p>
          The squash constant <em>k</em> and the weights <em>w₁</em> and <em>w₂</em> are settings of the run. Each snapshot records the ones it used, and the Adaptivity page lists them.
        </p>

        <h2 className="rh-t-title" id="m-decide">
          Kept or rebuilt
        </h2>
        <p>
          A region scoring at or above the <strong>boundary</strong> keeps its package. The boundary is 0.5 unless a run sets another, and each snapshot records the one it used. Below it, the region is
          rebuilt by community detection over its dependencies. A score close to the boundary is a close call, and the Decisions page lists those.
        </p>

        <h2 className="rh-t-title" id="m-small">
          Regions too small to measure
        </h2>
        <p>
          A region with fewer than two files, no dependencies inside it, or no internal strength cannot be measured. It scores 0 by rule and is rebuilt without assessment. Shares such as
          &ldquo;kept&rdquo; count the assessed regions only, and every page that shows one says so.
        </p>

        <h2 className="rh-t-title" id="m-same">
          Same input, same output
        </h2>
        <p>
          Group ids are hashes of their sorted member ids and clustering uses a fixed seed. Indexing the same commit twice produces byte-identical files, so a link to a region or a decision stays
          valid.
        </p>

        <h2 className="rh-t-title" id="m-views">
          The views
        </h2>
        <ul>
          {VIEWS.map((view) => (
            <li key={view.name}>
              <strong>{view.name}</strong>: {view.about}
            </li>
          ))}
        </ul>
      </article>

      <nav className="rh-doc-toc rh-t-caption" aria-label="On this page">
        <Text role="label">On this page</Text>
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            onClick={(event) => {
              event.preventDefault();
              jumpTo(section.id);
            }}
          >
            {section.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
