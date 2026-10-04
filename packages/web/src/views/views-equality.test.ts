/**
 * Every view built from the engine's in-memory
 * grouping output equals the view built from `parseIndex` of the written index
 * (the body today's GET routes return), on sample-java-project and on Broadleaf.
 *
 * Lives in `packages/web` because it is the only package that can import both
 * the route logic and `@repohive/views`; the engine is a dev dependency for this
 * test only. Comparison is on `JSON.stringify`, so key order counts too.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseIndex, type GroupingOutput } from "@repohive/core";
import { indexProject } from "@repohive/engine";
import {
  buildSnapshotViews,
  buildSnapshotViewsFromIndex,
  computeBlastRadius,
  fromGroupingOutput,
  type SnapshotViews,
} from "@repohive/views";

const workspaceRoot = path.resolve(process.cwd(), "..", "..");
const scratch = mkdtempSync(path.join(tmpdir(), "repohive-views-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface Case {
  name: string;
  dir: string;
}

const cases: Case[] = [
  { name: "sample-java-project", dir: path.join(workspaceRoot, "fixtures", "sample-java-project") },
  { name: "broadleaf", dir: path.join(workspaceRoot, "fixtures", "BroadleafCommerce") },
];

function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return `first difference at character ${i}: ${JSON.stringify(a.slice(Math.max(0, i - 60), i + 60))} vs ${JSON.stringify(b.slice(Math.max(0, i - 60), i + 60))}`;
}

function expectSame(label: string, fromMemory: unknown, fromDisk: unknown): void {
  const a = JSON.stringify(fromMemory);
  const b = JSON.stringify(fromDisk);
  expect(a === b ? "same" : `${label} differs: ${firstDifference(a, b)}`).toBe("same");
}

for (const fixture of cases) {
  const present = existsSync(fixture.dir);
  describe.skipIf(!present)(`views equality: ${fixture.name}`, () => {
    it(
      "every view from groupingOutput equals the view from parseIndex of the written index",
      async () => {
        const outputDirectory = path.join(scratch, fixture.name);
        const run = await indexProject({ projectDirectory: fixture.dir, outputDirectory });
        expect(run.ok).toBe(true);
        if (!run.ok) return;
        const groupingOutput: GroupingOutput = run.value.groupingOutput;

        const written = parseIndex(path.join(outputDirectory, "index"));
        expect(written.ok).toBe(true);
        if (!written.ok) return;

        const entry = { id: fixture.name, name: fixture.name };
        const memory = buildSnapshotViews(groupingOutput, entry);
        const disk = buildSnapshotViewsFromIndex(written.value, entry);

        for (const key of Object.keys(disk) as (keyof SnapshotViews)[]) {
          expectSame(key, memory[key], disk[key]);
        }
        // Every region has a detail and a lookup entry; every available level has an architecture view.
        expect(memory.regionDetails.length).toBe(groupingOutput.metadata.regionDecisions.length);
        expect(Object.keys(memory.regionDetailIndex).length).toBe(memory.regionDetails.length);
        expect(memory.architectureLevels.length).toBe(memory.architecture.availableLevels.length);

        // The blast-radius traversal, on the normalised in-memory hierarchy, gives the disk answer for sampled nodes.
        const fromMemory = fromGroupingOutput(groupingOutput).hierarchy;
        const ids = [...written.value.hierarchy.nodes.keys()];
        for (const id of ids.filter((_, i) => i % Math.max(1, Math.floor(ids.length / 25)) === 0)) {
          expectSame(`blast-radius ${id}`, computeBlastRadius(fromMemory, id), computeBlastRadius(written.value.hierarchy, id));
        }
      },
      300_000,
    );

    it("views are deterministic: a second run gives identical bytes", async () => {
      const run = async (leaf: string) => {
        const result = await indexProject({ projectDirectory: fixture.dir, outputDirectory: path.join(scratch, leaf) });
        if (!result.ok) throw new Error("index failed");
        return JSON.stringify(buildSnapshotViews(result.value.groupingOutput, { id: fixture.name, name: fixture.name }));
      };
      expect(await run(`${fixture.name}-a`)).toBe(await run(`${fixture.name}-b`));
    }, 300_000);
  });
}
