# @repohive/engine

Pipeline orchestration for RepoHIVE: one async call, `indexProject`, that runs
`@repohive/parser`'s parse then `@repohive/core`'s group, writing `graph.json`
and the five-file `index/` contract under a single output root.

Terminology: "the engine packages" means the engine side of the
engine/ecosystem boundary collectively (`shared`, `parser`, `core`, and this
package). "The engine orchestration package" means this package alone.

## Usage

```ts
import { indexProject } from "@repohive/engine";

const result = await indexProject({ projectDirectory: "/path/to/java/project" });
if (result.ok) {
  console.log(result.value.indexDirectory, result.value.durationMs);
} else {
  // result.stage is "engine" | "parse" | "group", carrying that
  // stage's native errors unmodified.
}
```

Artifact layout (an option overrides the root; `view/` is not this package's
scope):

```
<projectDirectory>/.repohive/
  graph.json    # stage-1 output, written by the parser
  index/        # the five-file engine contract, written by core
```

## Semantics worth knowing

- **v1 always parses.** `parseSkipped` is part of the stable result shape and
  is always `false` until the snapshot-id seam can decide "current" correctly.
  A wrong skip would silently serve a stale index; a redundant parse only costs
  seconds.
- **`concurrency` is accepted but inert in this release.** It is validated (an
  integer >= 1) and reserved for the parser read prefetch, which is wired up in
  a follow-up change. It is an internal knob, not a CLI flag.
- **Progress is coarse in v1**: `start`/`complete` at stage boundaries via
  `options.onProgress`. The `"progress"` kind with `completed`/`total` is
  declared but not yet emitted; per-item events land later with no signature
  change.
- **The graph is handed over in memory.** `parseProject` returns the document it
  just wrote on `ParseSuccess.graph`, so the engine groups straight from memory
  and never reads `graph.json` back. The file is still always written (it is the
  committed layout and the input to a group-only re-run), and the read-back
  branch stays for a `parse` dependency that returns no graph.
- **Timing never reaches an artifact.** Durations exist only on the returned
  result; artifacts stay byte-identical across runs over identical input.
- **Failure atomicity is the stages' own**: a failed parse writes nothing (a
  prior `graph.json` survives byte-for-byte); a failed group leaves
  `graph.json` in place (the failure names it) and stages the index before
  promoting, so an existing `index/` survives everything short of a failure
  inside the five-rename promotion window.

## Boundary

Engine-side: imports only `@repohive/shared`, `@repohive/parser`, and
`@repohive/core`. Imported by ecosystem consumers (the packaged CLI, the MCP
server, the hosted service). Must never import from `cli`, `web`, `ui`,
`api-client`, or `types`.

## Commands (from the repo root)

```
npm run build --workspace @repohive/engine
npm test --workspace @repohive/engine               # unit tests (build first)
npm run test:integration --workspace @repohive/engine
```

The unit script chains one `node --test` invocation per file so a missing
compiled test file fails the run loudly instead of being silently skipped
(single-invocation enumeration drops missing files on Node 21+ when at least
one listed file resolves). The integration suite runs the real pipeline over
`fixtures/sample-java-project` and compares against recorded digests; the
fixture is a git-ignored clone target, so those tests skip with an explicit
message when it is absent.
