"use client";

import { useState } from "react";
import type { RepositoryRef, RepositorySummary, SnapshotManifest, SnapshotState, ViewBodies } from "../../contracts";
import { Button, LinkButton } from "../../components/button";
import { Page, Text } from "../../components/feedback";
import { KeyValueList, Panel } from "../../components/panel";
import { DecisionTag, SplitBar } from "../../components/status";
import { Table, type TableColumn } from "../../components/table";
import { Icon } from "../../icons/icons";
import { useClient, useLink, useNavigate } from "../../provider/design-provider";
import { useToast } from "../../provider/toast";
import { routes } from "../../routes";
import { formatCount, formatDate, formatScore, formatShare, shortId } from "./format";
import { decisionsHref } from "./links";
import { commonNamePrefix, levelName, shortName } from "./names";
import { assessedRegions, closestToBoundary, decisionOf, largestRegions, tallyByModule, type Region } from "./regions";
import { Await, SnapshotGate } from "./snapshot-gate";
import { useLoaded, useSnapshotViews } from "./use-views";

/** The views the Overview reads. */
export type OverviewViews = Pick<ViewBodies, "adaptivity" | "regionDecisions" | "hierarchyScale">;

export interface OverviewViewProps extends RepositoryRef {
  readonly snapshotId: string;
  readonly views: OverviewViews;
  /** The repository's latest facts; used only when they describe this snapshot. */
  readonly summary?: RepositorySummary;
  readonly manifest?: SnapshotManifest;
}

const LARGEST_COUNT = 8;
const CLOSE_CALL_COUNT = 6;
const MODULE_COUNT = 6;

/** The repository whose figures the page shows: the one named like this page's, else the first the view holds. */
export function figuresFor(adaptivity: ViewBodies["adaptivity"], owner: string, name: string) {
  const id = `${owner}/${name}`.toLowerCase();
  return adaptivity.repos.find((repo) => repo.id.toLowerCase() === id) ?? adaptivity.repos[0];
}

function Figure({ value, label }: { readonly value: string; readonly label: string }) {
  return (
    <div>
      <Text role="heading" figure>
        {value}
      </Text>
      <Text role="caption" tone="subtle">
        {label}
      </Text>
    </div>
  );
}

/** The Overview from loaded data: the repository in figures, what the engine decided, and the snapshot it came from. */
export function OverviewView({ owner, name, snapshotId, views, summary, manifest }: OverviewViewProps) {
  const Link = useLink();
  const navigate = useNavigate();
  const figures = figuresFor(views.adaptivity, owner, name);
  const { regionDecisions, hierarchyScale } = views;

  if (figures === undefined) {
    return (
      <Page>
        <p className="rh-fg3" role="status">
          This snapshot recorded no figures for {owner}/{name}.
        </p>
      </Page>
    );
  }

  const assessed = assessedRegions(regionDecisions.regions);
  const largest = largestRegions(assessed, LARGEST_COUNT);
  const closeCalls = closestToBoundary(assessed, regionDecisions.boundary, CLOSE_CALL_COUNT);

  const prefix = commonNamePrefix(regionDecisions.regions.map((region) => region.displayName));
  const regionName = (region: Region) => (
    <span className="rh-v-name" title={region.displayName}>
      {shortName(region.displayName, prefix)}
    </span>
  );
  const modules = tallyByModule(regionDecisions.regions, prefix, MODULE_COUNT);
  const moduleMax = Math.max(1, ...modules.map((module) => module.kept + module.rebuilt));

  const levelSizes = hierarchyScale.levels.map((level) => ({ level: level.level, nodes: level.groupNodeCount + level.leafNodeCount }));
  const levelMax = Math.max(0, ...levelSizes.map((level) => Math.log10(Math.max(1, level.nodes))));

  const indexedAt = summary !== undefined && summary.snapshotId === snapshotId ? formatDate(summary.indexedAt) : undefined;

  const columns: TableColumn<Region>[] = [
    { key: "name", header: "Region", render: regionName },
    { key: "files", header: "Files", numeric: true, render: (region) => formatCount(region.fileCount) },
    { key: "groups", header: "Groups", numeric: true, render: (region) => formatCount(region.groupIds.length) },
    { key: "cohesion", header: "Cohesion", numeric: true, render: (region) => formatScore(region.cohesion) },
    { key: "coupling", header: "Coupling", numeric: true, render: (region) => formatScore(region.coupling) },
    { key: "score", header: "Score", numeric: true, render: (region) => formatScore(region.score) },
    { key: "decision", header: "Decision", render: (region) => <DecisionTag decision={decisionOf(region)} /> },
  ];

  return (
    <Page>
      <header className="rh-v-head">
        <div>
          <span className="rh-fg3">{owner} /</span>
          <Text as="h1" role="heading">
            {name}
          </Text>
          <Text role="caption" className="rh-v-meta">
            <span>
              Snapshot <span className="rh-mono">{shortId(snapshotId)}</span>
            </span>
            {indexedAt === undefined ? null : <span>Indexed {indexedAt}</span>}
            <span>Java</span>
          </Text>
        </div>
      </header>

      <div className="rh-v-figs">
        <Figure value={formatCount(figures.files)} label="files" />
        <Figure value={formatCount(figures.nodes)} label="nodes" />
        <Figure value={formatCount(figures.edges)} label="edges" />
        <Figure value={formatCount(figures.regions)} label="regions" />
        <Figure value={formatShare(figures.preserveShare)} label="kept, of assessed" />
      </div>

      <div className="rh-v-grid-3">
        <Panel
          title="Decisions"
          actions={
            <LinkButton variant="ghost" size="sm" href={decisionsHref(owner, name)}>
              Open <Icon name="arrow" size={14} />
            </LinkButton>
          }
        >
          <SplitBar
            label={`${figures.preserved} kept, ${figures.reconstructed} rebuilt, ${figures.degenerate} not assessed`}
            segments={[
              { kind: "kept", value: figures.preserved },
              { kind: "rebuilt", value: figures.reconstructed },
              { kind: "unassessed", value: figures.degenerate },
            ]}
          />
          <div className="rh-v-legend rh-t-caption">
            <DecisionTag decision="kept">{formatCount(figures.preserved)} kept</DecisionTag>
            <DecisionTag decision="rebuilt">{formatCount(figures.reconstructed)} rebuilt</DecisionTag>
            <DecisionTag decision="unassessed">{formatCount(figures.degenerate)} not assessed</DecisionTag>
          </div>
          <p className="rh-fg2">
            {formatCount(figures.assessed)} of {formatCount(figures.regions)} regions were large enough to measure. {formatCount(figures.preserved)} kept their package; the
            rest were rebuilt from their dependencies.
          </p>
        </Panel>

        <Panel
          title="By module"
          actions={
            <Text role="caption" tone="subtle">
              Assessed regions
            </Text>
          }
        >
          <div className="rh-v-mods">
            {modules.map((module) => {
              const total = module.kept + module.rebuilt;
              return (
                <div key={module.name} className="rh-v-mod">
                  <span className="rh-fg2">{module.name}</span>
                  <SplitBar
                    className="rh-v-mod-bar"
                    label={`${module.name}: ${module.kept} kept, ${module.rebuilt} rebuilt`}
                    segments={[
                      { kind: "kept", value: module.kept },
                      { kind: "rebuilt", value: module.rebuilt },
                    ]}
                    width={(total / moduleMax) * 100}
                  />
                  <span className="rh-v-n rh-t-caption">
                    {module.kept} / {total}
                  </span>
                </div>
              );
            })}
            <Text role="caption" tone="subtle">
              Kept out of assessed, per top-level module.
            </Text>
          </div>
        </Panel>

        <Panel
          title="Hierarchy depth"
          actions={
            <Text role="caption" tone="subtle">
              Log scale
            </Text>
          }
        >
          <div className="rh-v-levels">
            {levelSizes.map((level) => (
              <div key={level.level} className="rh-v-level">
                <span className="rh-fg2">{levelName(level.level, levelSizes.length)}</span>
                <i style={{ width: `${levelMax === 0 ? 0 : (Math.log10(Math.max(1, level.nodes)) / levelMax) * 100}%` }} />
                <span className="rh-v-n">{formatCount(level.nodes)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="rh-v-grid-2">
        <Panel
          title="Close calls"
          padded={false}
          actions={
            <Text role="caption" tone="subtle">
              Smallest margin from the {String(regionDecisions.boundary)} boundary
            </Text>
          }
        >
          <ul className="rh-v-rows">
            {closeCalls.map((region) => (
              <li key={region.regionId}>
                <Link href={decisionsHref(owner, name, region.regionId)} className="rh-v-row-link">
                  {regionName(region)}
                  <span className="rh-tag rh-t-caption">
                    <span className="rh-mono rh-fg2">{formatScore(region.score)}</span>
                    <DecisionTag decision={decisionOf(region)} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Snapshot"
          actions={
            <Text role="caption" tone="subtle">
              Recorded with the index
            </Text>
          }
        >
          <KeyValueList
            items={[
              { label: "Snapshot", value: <span className="rh-mono">{shortId(snapshotId)}</span> },
              ...(manifest === undefined ? [] : [{ label: "Index format", value: `Version ${manifest.indexFormatVersion}, five files` }]),
              { label: "Boundary", value: <span className="rh-mono">{String(regionDecisions.boundary)}</span> },
              ...(regionDecisions.seed === null ? [] : [{ label: "Seed", value: <span className="rh-mono">{regionDecisions.seed}</span> }]),
              ...(figures.config.maxGroupSize === null ? [] : [{ label: "Largest group", value: `${formatCount(figures.config.maxGroupSize)} files` }]),
              { label: "Depth", value: `${figures.depth} levels` },
            ]}
          />
        </Panel>
      </div>

      <section className="rh-v-section">
        <div className="rh-v-section-head">
          <Text as="h2" role="title">
            Largest regions
          </Text>
          <Text role="caption" tone="subtle">
            By file count, assessed regions
          </Text>
        </div>
        <div className="rh-panel">
          <Table
            caption="Largest regions"
            columns={columns}
            rows={largest}
            rowKey={(region) => region.regionId}
            onRowActivate={(region) => navigate(decisionsHref(owner, name, region.regionId))}
          />
        </div>
      </section>
    </Page>
  );
}

/** The top-bar actions of the Overview: index again, or open the map. */
export function OverviewActions({ owner, name }: RepositoryRef) {
  const client = useClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const reindex = (): void => {
    setBusy(true);
    client.requestIndex(`${owner}/${name}`).then(
      (result) => {
        setBusy(false);
        switch (result.status) {
          case "accepted":
          case "joined":
            navigate(routes.job(result.jobId));
            return;
          case "cached":
            toast("This commit is already indexed.");
            return;
          case "busy":
            toast(`The service is busy. Try again in ${result.retryAfterSeconds} seconds.`);
            return;
          case "rejected":
            toast(result.message);
            return;
        }
      },
      () => {
        setBusy(false);
        toast("The request could not be sent.");
      },
    );
  };

  return (
    <>
      <Button size="sm" disabled={busy} onClick={reindex}>
        <Icon name="refresh" size={14} />
        <span className="rh-hide-sm">Re-index</span>
      </Button>
      <LinkButton size="sm" variant="primary" href={routes.repoView(owner, name, "knowledge-graph")}>
        Open map
      </LinkButton>
    </>
  );
}

export interface OverviewScreenProps extends RepositoryRef {
  readonly snapshot: SnapshotState;
}

/** The Overview page: waits for the snapshot, loads its three views and the repository's facts, then draws. */
export function OverviewScreen({ owner, name, snapshot }: OverviewScreenProps) {
  return (
    <SnapshotGate owner={owner} name={name} snapshot={snapshot} what="the overview">
      {(snapshotId) => <OverviewData owner={owner} name={name} snapshotId={snapshotId} />}
    </SnapshotGate>
  );
}

function OverviewData({ owner, name, snapshotId }: RepositoryRef & { readonly snapshotId: string }) {
  const views = useSnapshotViews(snapshotId, ["adaptivity", "regionDecisions", "hierarchyScale"] as const);
  // The facts only decorate the header and the snapshot panel, so a failed read leaves them out.
  const facts = useLoaded(`${owner}/${name}:${snapshotId}`, async (client) => ({
    summary: await client.repository(owner, name).catch(() => undefined),
    manifest: await client.manifest(snapshotId).catch(() => undefined),
  }));
  return (
    <Await loaded={views} what="the overview">
      {(bodies) => (
        <OverviewView
          owner={owner}
          name={name}
          snapshotId={snapshotId}
          views={bodies}
          summary={facts.status === "ready" ? facts.data.summary : undefined}
          manifest={facts.status === "ready" ? facts.data.manifest : undefined}
        />
      )}
    </Await>
  );
}
