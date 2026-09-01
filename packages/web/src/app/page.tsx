import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, ScanSearch } from "lucide-react";
import { BrandLogo } from "@/components/layout/brand-logo";
import {
  listRegistryRepos,
  resolveIndexDir,
  type RepoRegistryEntry,
} from "@/lib/repohive/repo-registry";
import { loadIndex } from "@/lib/repohive/index-loader";

export const metadata: Metadata = { title: "RepoHIVE" };

/**
 * Landing — an honest index of what this machine has actually indexed.
 *
 * Every number on this page is read from a repo's `index/` on disk at request
 * time: file/edge counts from the parsed hierarchy, the preserve/reconstruct
 * split from the recorded region decisions. A registered fixture whose index
 * is absent (the large ones are git-ignored) is shown as absent, with the
 * command that would produce it — never as a row of zeros pretending to be a
 * measurement.
 */
export const dynamic = "force-dynamic";

interface RepoCard {
  entry: RepoRegistryEntry;
  stats: {
    files: number;
    leafEdges: number;
    depth: number;
    regions: number;
    preserved: number;
    reconstructed: number;
    boundary: number;
  } | null;
}

function readRepoCard(entry: RepoRegistryEntry): RepoCard {
  const result = loadIndex(resolveIndexDir(entry));
  if (!result.ok) return { entry, stats: null };
  const { hierarchy, metadata } = result.value;
  let files = 0;
  for (const node of hierarchy.nodes.values()) {
    if (node.kind === "file") files += 1;
  }
  const preserved = metadata.regionDecisions.filter((d) => d.action === "preserve").length;
  return {
    entry,
    stats: {
      files,
      leafEdges: hierarchy.leafEdges.length,
      depth: hierarchy.depth,
      regions: metadata.regionDecisions.length,
      preserved,
      reconstructed: metadata.regionDecisions.length - preserved,
      boundary: metadata.structuralQualityBoundary,
    },
  };
}

function SplitBar({ preserved, reconstructed }: { preserved: number; reconstructed: number }) {
  const total = preserved + reconstructed;
  if (total === 0) return null;
  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-inset)]"
      role="img"
      aria-label={`${preserved} of ${total} regions preserved, ${reconstructed} reconstructed`}
    >
      <div
        className="h-full bg-[var(--color-success)]"
        style={{ width: `${(preserved / total) * 100}%` }}
      />
      <div
        className="h-full bg-[var(--color-warning)] opacity-80"
        style={{ width: `${(reconstructed / total) * 100}%` }}
      />
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
        {label}
      </dt>
      <dd className="tabular-nums text-sm text-[var(--color-text-primary)]">{value}</dd>
    </div>
  );
}

export default function LandingPage() {
  const cards = listRegistryRepos().map(readRepoCard);
  const present = cards.filter((c) => c.stats !== null);
  const absent = cards.filter((c) => c.stats === null);

  return (
    <div className="mx-auto max-w-[880px] p-5 sm:p-8">
      <header className="flex items-start gap-3 pt-2 sm:pt-6">
        <BrandLogo size={34} className="mt-1 shrink-0" />
        <div>
          <h1 className="font-serif text-2xl text-[var(--color-text-primary)] sm:text-3xl">
            RepoHIVE
          </h1>
          <p className="mt-1 max-w-[52ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
            A hierarchical index of each repository below, built by measuring every package&rsquo;s
            structure and deciding, region by region, whether to{" "}
            <span className="text-[var(--color-success)]">preserve</span> its authored boundary or{" "}
            <span className="text-[var(--color-warning)]">reconstruct</span> it from the
            dependencies. Every decision is recorded; every number here is read from that record.
          </p>
        </div>
      </header>

      <section className="mt-8 space-y-3" aria-label="Indexed repositories">
        {present.length === 0 && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-6 text-sm text-[var(--color-text-secondary)]">
            No index is present on this machine yet. Run{" "}
            <code className="rounded bg-[var(--color-bg-inset)] px-1.5 py-0.5 font-mono text-xs">
              npm run parse -- fixtures/sample-java-project
            </code>{" "}
            then{" "}
            <code className="rounded bg-[var(--color-bg-inset)] px-1.5 py-0.5 font-mono text-xs">
              npm run group -- fixtures/sample-java-project
            </code>
            .
          </div>
        )}

        {present.map(({ entry, stats }) => (
          <Link
            key={entry.id}
            href={`/repos/${entry.id}/knowledge-graph`}
            className="group block rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5 transition-colors hover:border-[var(--color-border-active)] hover:bg-[var(--color-bg-elevated)]"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <ScanSearch className="h-4 w-4 shrink-0 text-[var(--color-accent-primary)]" />
                <span className="truncate font-serif text-lg text-[var(--color-text-primary)]">
                  {entry.name}
                </span>
              </div>
              <span className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] transition-colors group-hover:text-[var(--color-accent-primary)]">
                Open
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </div>

            {stats && (
              <>
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
                  <Figure label="Files" value={String(stats.files)} />
                  <Figure label="Dependencies" value={String(stats.leafEdges)} />
                  <Figure label="Depth" value={String(stats.depth)} />
                  <Figure label="Regions" value={String(stats.regions)} />
                  <Figure
                    label="Preserved / rebuilt"
                    value={`${stats.preserved} / ${stats.reconstructed}`}
                  />
                </dl>
                <div className="mt-3">
                  <SplitBar preserved={stats.preserved} reconstructed={stats.reconstructed} />
                </div>
              </>
            )}
          </Link>
        ))}

        {absent.length > 0 && (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-default)] p-5">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
              Registered, index not on this machine
            </p>
            <ul className="mt-2 space-y-1.5">
              {absent.map(({ entry }) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-[var(--color-text-secondary)]"
                >
                  <span className="font-medium text-[var(--color-text-primary)]">{entry.name}</span>
                  <code className="font-mono text-xs text-[var(--color-text-tertiary)]">
                    npm run parse -- fixtures/{entry.dir} &amp;&amp; npm run group -- fixtures/
                    {entry.dir}/graph.json fixtures/{entry.dir}/index
                  </code>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
