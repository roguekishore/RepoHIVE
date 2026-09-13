/**
 * Test support: generate the real index fixture the tests read.
 *
 * Runs the actual pipeline (parse then group) over the checked-in
 * `fixtures/sample-java-project`, writing `graph.json` and `index/` inside the
 * fixture directory - both paths are git-ignored. The pipeline is
 * deterministic, so the fixture is byte-identical wherever it is generated.
 *
 * Skips work when the index already exists; pass --force to regenerate.
 * Wired as this package's `pretest`, so `npm test` is self-sufficient after a
 * build.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProject } from "@repohive/parser";
import { describeError, groupGraphToIndex, readGraphFile } from "@repohive/core";

/** Repository root, resolved from this compiled module's location. */
function repositoryRoot(): string {
  // Compiles to <repo>/packages/mcp/dist/make-fixture.js.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..");
}

export const FIXTURE_PROJECT_DIR = join(repositoryRoot(), "fixtures", "sample-java-project");
export const FIXTURE_GRAPH_PATH = join(FIXTURE_PROJECT_DIR, "graph.json");
export const FIXTURE_INDEX_DIR = join(FIXTURE_PROJECT_DIR, "index");

export async function makeFixture(force: boolean): Promise<number> {
  if (!existsSync(FIXTURE_PROJECT_DIR)) {
    console.error(
      `make-fixture: fixture project not found: ${FIXTURE_PROJECT_DIR}\n` +
        "Copy fixtures/sample-java-project from the main checkout first (it is git-ignored).",
    );
    return 1;
  }
  if (!force && existsSync(join(FIXTURE_INDEX_DIR, "metadata.json"))) {
    console.error(`make-fixture: index already present at ${FIXTURE_INDEX_DIR} (use --force to regenerate)`);
    return 0;
  }

  const parsed = await parseProject({
    projectDirectory: FIXTURE_PROJECT_DIR,
    outputPath: FIXTURE_GRAPH_PATH,
  });
  if (!parsed.ok) {
    console.error(
      ["make-fixture: parse failed:", ...parsed.errors.map((e) => `  - ${e.reason}: ${e.message}`)].join("\n"),
    );
    return 1;
  }

  const graph = readGraphFile(FIXTURE_GRAPH_PATH);
  if (!graph.ok) {
    console.error(`make-fixture: ${describeError(graph.error)}`);
    return 1;
  }
  const grouped = groupGraphToIndex(graph.value, FIXTURE_INDEX_DIR, {});
  if (!grouped.ok) {
    console.error(`make-fixture: group failed: ${describeError(grouped.error)}`);
    return 1;
  }
  console.error(
    `make-fixture: wrote ${FIXTURE_INDEX_DIR} ` +
      `(${grouped.value.metadata.nodeCount} nodes, ${grouped.value.metadata.regionDecisions.length} regions)`,
  );
  return 0;
}

if (process.argv[1]?.endsWith("make-fixture.js")) {
  makeFixture(process.argv.includes("--force"))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause: unknown) => {
      console.error(`make-fixture: ${cause instanceof Error ? cause.message : String(cause)}`);
      process.exitCode = 1;
    });
}
