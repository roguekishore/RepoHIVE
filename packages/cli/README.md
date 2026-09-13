# repohive

The RepoHIVE command line interface. Publishes unscoped as `repohive`, depending on
`@repohive/shared`, `@repohive/parser`, `@repohive/core` and `@repohive/engine` rather than bundling
them.

```
npm i -g repohive      # then: repohive index .
npx repohive index .   # no install
```

`npm repohive index` is **not** a valid invocation. npm's subcommands are its own and cannot be
extended. The long form of the second line above is `npm exec repohive index .`, which `npx`
abbreviates.

Nothing here is published yet. The package is `private: true` at `0.0.0` to match its siblings;
publishing is a separate, owner-driven change.

## Commands

```
repohive index <dir> [--out <dir>] [--json] [<grouping flags>]
    parse, then group. -> <out>/graph.json + <out>/index/

repohive parse <dir> [--out <dir>] [--include-generated] [--exclude a,b] [--json]
    stage 1 alone. -> <out>/graph.json

repohive group <graph.json | dir> [outDir] [--out <dir>] [--json] [<grouping flags>]
    stage 2 alone. -> the five-file index/

repohive view
    not in this release

repohive --version | --help
repohive <command> --help
```

Grouping flags, accepted by `index` and `group` alike: `--boundary` `--seed` `--max-group-size`
`--min-partition-threshold` `--weight-cohesion` `--weight-coupling` `--weight-modularity`
`--squash-k` `--degenerate-score` `--compute-modularity` `--preserve <regionId>`
`--reconstruct <regionId>`. Every value passes through the core's `validateConfig`, so the CLI is
not a second injection route for values that gate rejects.

The stages stay separately invokable because algorithm spec Req 4.4 requires boundary sweeps
without code changes, and because running `parse` alone is the natural move when a graph looks
wrong. `index` is the product interface; `parse` and `group` are the research and debugging one.

### `index` always parses

There is no skip-when-current in v1. Deciding "current" correctly is the snapshot-id seam, the cheap
substitute is an mtime comparison, and a wrong skip silently serves a stale index, which is far
worse than a redundant parse. The result reports `parseSkipped: false` so the field is already the
right shape for when skipping does land.

### `view`

Dispatch recognizes `view` and exits 2 with "ships in a later release". It is not omitted, because
answering `unknown command: view` would suggest the name is undecided and send someone hunting for
a different spelling of a command that is simply not here yet. The name is final; only the viewer
is Stage 2.

## Output layout

```
.repohive/
  graph.json    # stage-1 output
  index/        # the five-file contract: repository, nodes, edges, hierarchy, metadata
```

`--out <dir>` always names **the directory this command writes into**. For `index` that is the
output root, which gains `graph.json` and an `index/` subdirectory. For `parse` it is where
`graph.json` lands. For `group` it is the directory that receives the five index files, so a sweep
can put each run somewhere of its own.

Defaults: `index` and `parse` write to `<dir>/.repohive`. `group` writes to a sibling `index/` of
the graph file it read, so grouping `.repohive/graph.json` writes `.repohive/index/` without being
told to. A directory argument to `group` resolves to `<dir>/.repohive/graph.json` when that exists
and `<dir>/graph.json` otherwise, so `repohive parse X && repohive group X` composes.

`index/` is the published contract that MCP, the hosted service and third-party tooling read. It
stays separate and untouched.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | success |
| `1` | the request ran and failed: a stage reported a structured error |
| `2` | usage error: the command line could not be turned into a request |

`2` covers an unknown command, an unknown option, a missing option value, an extra positional, a
path argument that does not exist, and a command not in this release. The test is whether anything
was attempted. A path that exists but cannot be parsed is `1`, carrying the parser's own error; a
path that does not exist at all is `2`, in every command, and nothing is written or created.

## Streams

- **stdout** carries the result: human prose, or exactly one JSON document under `--json`.
- **stderr** carries diagnostics and human error prose, never any part of the result.

Under `--json` a command writes its document to stdout and nothing to stderr, on success and on
failure alike: the failure document is the result. So `repohive index . --json | jq .ok` is always
well formed.

`--version` and `--help` are the one exception. They print prose to stdout even under `--json`,
because they answer a question about the tool rather than producing a result.

## `--json`

Machine-readable output is the primary output. The prose above is a rendering of exactly these
fields, never the other way round.

Every document carries `schemaVersion`, the `command`, and an `ok` discriminant. `schemaVersion` is
bumped only when a field is renamed, removed, or changes meaning; adding a field is not a bump, so
consumers must ignore fields they do not know.

**Not byte-reproducible.** Result documents carry measured durations, so two runs over identical
input differ. The artifacts under `.repohive/` are the deterministic outputs; this document
describes a run. `durationMs.total` is always present and always at least the sum of the stages
named beside it.

Fields marked optional are **omitted** when the underlying stage omits them, rather than defaulted
to zero.

### `index` success

```json
{
  "schemaVersion": 1,
  "command": "index",
  "ok": true,
  "result": {
    "outputDirectory": "/abs/project/.repohive",
    "graphPath": "/abs/project/.repohive/graph.json",
    "indexDirectory": "/abs/project/.repohive/index",
    "parseSkipped": false,
    "nodeCount": 29,
    "edgeCount": 6,
    "regionCount": 4,
    "preserveCount": 0,
    "reconstructCount": 4,
    "hierarchyDepth": 4,
    "crossScopeAmbiguities": 0,
    "excludedDirectoryCount": 3,
    "durationMs": { "parse": 23.05, "group": 5.31, "total": 28.63 }
  }
}
```

`nodeCount` and `edgeCount` are the parse-stage counts, the contents of `graph.json`.
`preserveCount` and `reconstructCount` are raw decision counts and include degenerate regions;
per-region detail is in `index/metadata.json`. `crossScopeAmbiguities` and
`excludedDirectoryCount` are optional.

### `parse` success

```json
{
  "schemaVersion": 1,
  "command": "parse",
  "ok": true,
  "result": {
    "outputDirectory": "/abs/project/.repohive",
    "graphPath": "/abs/project/.repohive/graph.json",
    "nodeCount": 29,
    "edgeCount": 6,
    "crossScopeAmbiguities": 0,
    "excludedDirectoryCount": 3,
    "durationMs": { "parse": 23.05, "total": 23.05 }
  }
}
```

### `group` success

```json
{
  "schemaVersion": 1,
  "command": "group",
  "ok": true,
  "result": {
    "graphPath": "/abs/project/.repohive/graph.json",
    "indexDirectory": "/abs/project/.repohive/index",
    "regionCount": 4,
    "preserveCount": 0,
    "reconstructCount": 4,
    "structuralQualityBoundary": 0.5,
    "hierarchyNodeCount": 38,
    "hierarchyDepth": 4,
    "leafEdgeCount": 6,
    "crossGroupEdgeCount": 8,
    "durationMs": { "group": 4.53, "total": 4.69 }
  }
}
```

`hierarchyNodeCount` counts nodes in the built hierarchy, not nodes in the input graph. It is
deliberately not called `nodeCount`, which means the graph count everywhere else.

### Failure

```json
{
  "schemaVersion": 1,
  "command": "index",
  "ok": false,
  "stage": "parse",
  "message": "one line, the same wording the prose uses",
  "errors": [{ "reason": "no-java-files", "message": "...", "path": "/abs/project" }]
}
```

`stage` says where it failed and selects the rest of the document:

| `stage` | Exit | Extra fields |
|---------|------|--------------|
| `usage` | `2` | none. `command` is `null` when no command was recognized |
| `engine` | `1` | `error`: `{ code: "INVALID_OPTIONS" \| "OUTPUT_DIRECTORY_UNWRITABLE" \| "INTERNAL_ERROR", ... }` |
| `parse` | `1` | `errors`: the parser's `ParseError[]`, each `{ reason, message, path? }` |
| `group` | `1` | `error`: the core's `GroupingError` (`{ code, ... }`), and `graphPath` |

Stage errors are passed through from the engine, the parser and the core unmodified rather than
reshaped, so a consumer can switch on the same codes the libraries define. `message` is the
engine's own one-line rendering, so prose and JSON never disagree.

On a `group`-stage failure `graphPath` names the `graph.json` that was written: a `group`-only
re-run can start from it.

## What is expensive to change later

The on-disk layout of `.repohive/`, the command and flag names, the `--json` shape, and the exit
codes. Once CI is written against them, changing any is a major version and a broken build for
whoever wrote it. Internal seams are retrofittable behind defaults; these are not.

## Development

```
npm run build --workspace repohive
npm test --workspace repohive
```

The test script chains one `node --test` invocation per file. Measured on Node v26.4.0: a single
invocation listing several files silently drops the missing ones and exits 0 when at least one
resolves, so a single-invocation script can go partially green after a file is renamed. Each
chained invocation is loud about its own missing file.

From the repository root, `npm run parse -- <dir>` and `npm run group -- <input>` run this binary.
They deliberately do not go through `npm run --workspace`: that changes the process working
directory to the package directory, and relative path arguments resolve against `process.cwd()`.
Both require `npm run build --workspace repohive` first; the root `build` script does not yet
include this package.
