# Design Document

## Overview

The **dependency graph parser** is the first stage of the RepoHIVE engine pipeline (`parse → group → view`) and the Review 1 deliverable. It reads a local Java project from disk, parses every Java source file into a transient per-file Tree-Sitter AST, **stitches** those per-file ASTs into a single cross-file dependency graph, and serializes that graph to one `graph.json` file that conforms exactly to the shared JSON contract consumed by the downstream grouping algorithm.

The parser lives in `packages/parser` of the npm-workspace monorepo. It depends on `packages/shared` for the JSON-contract type definitions (the stable seam) and on `graphology` for the in-memory directed graph, and it uses `web-tree-sitter` / `tree-sitter-java` for AST extraction. It writes nothing except `graph.json` and produces no partial output on failure.

Three design commitments dominate every decision below:

1. **Cross-file stitching is the core work.** Tree-Sitter gives an isolated AST per file; the parser resolves references *across* files through a symbol table and expresses them as directed, weighted edges.
2. **The JSON contract is inviolable.** `graph.json` matches `GraphNode` / `DependencyEdge` from `packages/shared` exactly so the grouping algorithm ingests it with zero rework. The parser leaves `strength` unset (the downstream weight calculator fills it).
3. **Determinism is a hard requirement.** No `Math.random`, no timestamps, no counters, no host paths, no filesystem-enumeration-dependent ordering. Identical input yields byte-identical `graph.json` (identical SHA-256). This is achieved with content-derived IDs and canonical ordering at every boundary.

### Scope boundaries

In scope: directory validation, recursive Java file collection, per-file AST extraction of `file`/`class`/`function` nodes, symbol-table construction, cross-file import-edge stitching, frequency-signal computation, canonical ordering, deterministic serialization, and structured error handling with no partial output.

Out of scope (downstream `hierarchical-repository-grouping` concerns): weighting/`strength`, structural-quality assessment, hierarchy assembly, blast radius, the `index/` file set, and visualization. Multi-language parsing is deferred; Phase 1 targets Java only.

### Requirements coverage map

| Requirement | Primary component(s) |
|---|---|
| R1 Validate project directory | `InputValidator` |
| R2 Collect Java source files | `SourceFileCollector` |
| R3 Extract nodes from ASTs | `AstExtractor` |
| R4 Build symbol table | `SymbolTableBuilder` |
| R5 Stitch cross-file edges | `Stitcher` |
| R6 Compute edge frequency signals | `Stitcher` (frequency accumulation) |
| R7 Conform to JSON contract | `GraphSerializer` + `shared` types |
| R8 Serialize to single file | `GraphSerializer` (atomic write) |
| R9 Deterministic output | `CanonicalOrder` + ID scheme (cross-cutting) |
| R10 Error handling, no partial output | `ParseErrorCollector` + orchestrator |

## Architecture

### Pipeline flow

```
Project_Directory (path)
        │
        ▼
┌───────────────────┐
│  InputValidator   │  R1  — existence, is-directory, readability; fail-fast
└───────────────────┘
        │ valid path
        ▼
┌───────────────────┐
│ SourceFileCollector│ R2  — recursive .java discovery, canonical (lexicographic) order
└───────────────────┘
        │ ordered file list  (empty ⇒ Parse_Error)
        ▼
┌───────────────────┐
│   AstExtractor    │  R3  — per file: Tree-Sitter parse → file/class/function nodes;
└───────────────────┘        AST discarded after extraction (transient)
        │ all Graph_Nodes + per-file reference records
        ▼
┌───────────────────┐
│ SymbolTableBuilder│  R4  — FQN → node map, deterministic collision resolution
└───────────────────┘
        │ Symbol_Table
        ▼
┌───────────────────┐
│     Stitcher      │  R5+R6 — resolve references → dedup directed edges + frequency signals
└───────────────────┘
        │ Dependency_Graph (graphology)
        ▼
┌───────────────────┐
│  GraphSerializer  │  R7+R8+R9 — validate endpoints, canonical order, atomic write
└───────────────────┘
        │
        ▼
     graph.json   (sole persisted artifact)
```

The orchestrator (`Parser_System`, exposed as `parseProject`) sequences these components. A shared `ParseErrorCollector` accumulates recoverable per-file errors (R10.1, R10.2); fatal errors (R1, R2.4, R2.5, R8.4) short-circuit immediately. Writing is deferred until all parsing completes (R10.3), and any recorded error aborts the write with no partial file left behind (R10.4, R10.6).

### Package layout

```
packages/
├── shared/                     JSON-contract types only (the stable seam)
│   └── src/
│       └── contract.ts         GraphNode, DependencyEdge, RawDependencyGraph, NodeKind
└── parser/
    └── src/
        ├── index.ts            public entry: parseProject(options) → Result
        ├── orchestrator.ts     Parser_System sequencing + error aggregation
        ├── input-validator.ts  R1
        ├── source-collector.ts R2
        ├── ast-extractor.ts    R3 (Tree-Sitter wrapper + node extraction)
        ├── symbol-table.ts     R4
        ├── stitcher.ts         R5, R6
        ├── serializer.ts       R7, R8, R9 (write path)
        ├── canonical.ts        R9 ordering + stable JSON stringify
        ├── ids.ts              content-derived node-ID scheme (R3.10, R9)
        ├── errors.ts           ParseError model + collector (R10)
        └── types.ts            internal (non-contract) working types
```

Only `shared/src/contract.ts` defines the on-disk shape. Internal working types (reference records, extraction results) stay in `parser/src/types.ts` and never leak into `graph.json`.

### Technology choices

- **`web-tree-sitter` + `tree-sitter-java`** — Tree-Sitter Java grammar for AST parsing. `web-tree-sitter` (WASM) is chosen over native `node-tree-sitter` bindings to avoid native-compilation friction across platforms/CI; parsing speed is negligible versus disk I/O at this scale (per performance steering). The grammar binding is isolated behind `AstExtractor` so it can be swapped without touching downstream logic.
- **`graphology`** — in-memory directed graph, matching the core spec's engine. Used as the working store for nodes and edges; provides natural de-duplication of edges by `(source, target)` key.
- **Node built-ins** (`node:fs/promises`, `node:path`, `node:crypto`) — filesystem traversal, path normalization, and SHA-256 (content-hash IDs + determinism verification in tests). No third-party path or hashing libs.
- **`fast-check` + a unit runner** (Node's built-in `node:test`) — property-based verification of the correctness properties in the Testing Strategy.

### Result and error model

The parser returns a discriminated `Result` rather than throwing across boundaries, so callers handle failure explicitly:

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; errors: E[] };

type ParseErrorReason =
  | "no-path-provided"        // R1.3
  | "path-not-found"          // R1.4
  | "path-not-directory"      // R1.5
  | "directory-unreadable"    // R1.6, R2.4
  | "no-java-files"           // R2.5
  | "file-unreadable"         // R10.2
  | "file-unparseable"        // R10.1
  | "output-unwritable";      // R8.4, R8.5

interface ParseError {
  reason: ParseErrorReason;
  message: string;            // human-readable nature of failure (R10.5)
  path?: string;              // file/dir involved, when applicable (R1.4–6, R10.5)
}

interface ParseSuccess {
  outputPath: string;         // absolute path to written graph.json
  nodeCount: number;
  edgeCount: number;
}
```

Fatal input errors return exactly one `ParseError` (R1.7). Recoverable per-file errors accumulate; if any were recorded the run returns them all and writes nothing (R10.4).

## Components and Interfaces

### shared/contract.ts — the JSON contract (stable seam)

The exact shape, copied from the core spec's Data Models so both specs agree. The parser emits only the `file`/`class`/`function` subset of `NodeKind` and never emits `strength`.

```typescript
export type NodeId = string;
export type NodeKind = "file" | "function" | "class" | "group" | "repository";

export interface GraphNode {
  id: NodeId;
  kind: NodeKind;
  packagePath?: string;    // omitted when no declared package (R7.3)
  directoryPath: string;   // "" when file is in project root (R3.6)
  definedInFile?: NodeId;  // present for class/function, omitted for file (R7.2)
}

export interface DependencyEdge {
  source: NodeId;
  target: NodeId;
  importFrequency: number;      // ≥ 0 integer
  methodCallFrequency: number;  // ≥ 0 integer
  sharedTypeCount: number;      // ≥ 0 integer
  strength?: number;            // NOT emitted by parser (R7.7)
}

export interface RawDependencyGraph {
  nodes: GraphNode[];
  edges: DependencyEdge[];
}
```

`graph.json` is exactly a serialized `RawDependencyGraph`.

### InputValidator (R1)

```typescript
interface InputValidator {
  validate(projectDirectory: string | null | undefined): Promise<Result<ValidatedPath, ParseError>>;
}
interface ValidatedPath { absolutePath: string; }
```

Behavior:
- Reject null/empty/whitespace-only → `no-path-provided` (R1.3).
- `fs.stat`: `ENOENT` → `path-not-found` (R1.4); not a directory → `path-not-directory` (R1.5).
- Probe readability via `fs.opendir` (open + list one entry); `EACCES`/`EPERM` → `directory-unreadable` (R1.6).
- All checks complete before any collection begins; on failure return exactly one error and do no collection (R1.2, R1.7).

### SourceFileCollector (R2)

```typescript
interface SourceFileCollector {
  collect(root: ValidatedPath): Promise<Result<CollectedFile[], ParseError>>;
}
interface CollectedFile {
  absolutePath: string;
  relativePath: string;   // POSIX-normalized, forward slashes, relative to root
}
```

Behavior:
- Recursive walk to any depth (R2.1). Include a regular file **iff** its name ends with `.java` compared case-sensitively (`.JAVA` excluded) (R2.2).
- Skip directories, symlinks, and non-`.java` regular files without error; **symlinks are not followed** (prevents cycles and non-determinism) (R2.3).
- A subdirectory that cannot be read (`EACCES`) → fatal `directory-unreadable` identifying that directory (R2.4).
- Zero `.java` files after a successful, readable walk → fatal `no-java-files` (R2.5).
- Return results sorted ascending byte-wise lexicographically by `relativePath`, so order is independent of filesystem enumeration (R2.6, R9.5). Relative paths are computed with `path.relative` then normalized to forward slashes for OS-independent ordering and for `directoryPath` derivation.

### AstExtractor (R3)

```typescript
interface AstExtractor {
  extract(file: CollectedFile, errors: ParseErrorCollector): ExtractionResult | null;
}
interface ExtractionResult {
  nodes: GraphNode[];              // one file node + class/function nodes
  references: RawReference[];      // unresolved references for the Stitcher
  packagePath: string;            // "" for default package
}
interface RawReference {
  fromNodeId: NodeId;              // referencing entity (file or class scope)
  targetName: string;             // imported/used name as written (may be FQN or simple)
  kind: "import" | "type-use" | "method-call";
}
```

Behavior per file:
- Parse with the Tree-Sitter Java grammar into a transient AST (R3.1).
- Emit exactly one `file` node (R3.2); one `class` node per class/interface/enum/record including nested/inner types (R3.3); one `function` node per method/constructor, one per overload distinguished by declared parameter-type list (R3.4).
- Read the `package_declaration` once; apply its dotted name as `packagePath` to every node in the file, or `""` if absent (R3.7, R3.8).
- `directoryPath` = POSIX directory of the file's `relativePath`, no leading separator, `""` at root (R3.5, R3.6).
- `class`/`function` nodes carry `definedInFile` = the file node's id (R3.9).
- Collect raw references (import declarations; and, where cheaply available, type uses / method calls) for later resolution. Phase 1 may populate only imports; the others feed the deferred frequency signals.
- **Discard the AST** as soon as extraction for the file returns; only `GraphNode`s and `RawReference`s (plain data) survive (R3.13).
- On unparseable content → record `file-unparseable` and return `null`; on read failure → record `file-unreadable`. Parsing of remaining files continues (R10.1, R10.2).

### Node identity (ids.ts) — R3.10–R3.12, R9

Node IDs are derived **solely** from stable structural attributes — never counters, timestamps, random values, memory addresses, or enumeration order (R3.10).

Canonical ID string forms (a stable, human-legible scheme):

| Kind | ID form | Example |
|---|---|---|
| file | `file:` + relativePath | `file:src/com/example/UserService.java` |
| class | `class:` + FQN (packagePath + nested-type chain) | `class:com.example.UserService` / `class:com.example.Outer$Inner` |
| function | `func:` + enclosing-class FQN + `#` + name + `(` + comma-joined param types + `)` | `func:com.example.UserService#save(com.example.User)` |

- The enclosing-type chain uses `$` for nesting (mirrors JVM binary-name convention) so nested types are unambiguous.
- Overloads differ because the parameter-type list is part of the function ID (R3.4).
- Because IDs are pure functions of file content + relative location, re-parsing an unchanged file yields identical IDs across runs (R3.11).
- **Uniqueness within a run:** the extractor asserts no two distinct nodes produce the same ID. If a genuine collision arises (e.g. two top-level types illegally sharing an FQN, which the Symbol_Table also handles), the deterministic tie-break in R4.5 governs symbol resolution while the node set still holds distinct nodes only when structurally distinct; identical structural identity means the same entity, so it is created once (R3.12).

`relativePath` (already forward-slash normalized and root-relative) is the only path material in an ID — no absolute/host paths ever enter an ID (R9.4).

### SymbolTableBuilder (R4)

```typescript
interface SymbolTable {
  lookup(fqn: string): NodeId | null;   // not-found returns null, never throws (R4.7)
}
interface SymbolTableBuilder {
  build(nodes: GraphNode[]): SymbolTable;
}
```

Behavior:
- Map each declared `class` by FQN = `packagePath + "." + simpleName`, or simple name alone when the file is in the default package (R4.2, R4.3).
- Map each declared `function` by `enclosingClassFqn + "." + simpleName` (R4.4). (Function keys support later cross-entity call resolution; Phase-1 import edges use class/file keys.)
- **Collision rule:** when two declarations map to the same FQN, keep exactly one — the node whose id sorts first under canonical (byte-wise lexicographic) order (R4.5).
- Build by iterating nodes in canonical id order so the map is byte-for-byte reproducible regardless of underlying map internals (R4.6).
- `lookup` returns `null` for absent keys (R4.7).

### Stitcher (R5, R6)

```typescript
interface Stitcher {
  stitch(
    nodes: GraphNode[],
    references: RawReference[],
    symbols: SymbolTable
  ): DependencyEdge[];
}
```

Resolution and edge construction:
- For each `RawReference`, resolve `targetName` through the `SymbolTable`. Unresolved names (target not in the project) are dropped — no edge, no synthetic external node (R5.4).
- Edges connect only `file`↔`file` or `class`↔`class` granularity; the referencing entity is mapped up to its file/class scope. **No edge may have a `function` endpoint** (R5.2).
- Drop any candidate edge whose source or target node is not in the node set (R5.5) and any self-edge, including intra-file references resolving to the same node (R5.6).
- **De-duplication + frequency accumulation:** edges are keyed by `(source, target)` in a map. Multiple resolved references between the same ordered pair collapse to **one** edge (R5.3), incrementing the relevant frequency accumulator rather than adding parallel edges.

Frequency signals (R6) — exactly the three contract fields, no more, no fewer (R6.1):
- `importFrequency` = count of resolved import-based references for the pair, each counted once (R6.2).
- `methodCallFrequency` = count of distinct resolved cross-entity method calls; **Phase-1 simplification: 0** when call resolution is not yet performed (R6.3).
- `sharedTypeCount` = count of distinct shared type references; **Phase-1 simplification: 0** when not yet performed (R6.4).
- Every signal is a finite, non-negative **integer**; a signal with no contributing reference is set to exactly `0`, never absent/undefined/NaN/Infinity (R6.5, R6.6).
- Recomputation on identical input yields identical values, and the whole edge set is independent of file/reference processing order because it is derived from a canonically-ordered node set and a deterministic symbol table (R5.7, R6.7).

### GraphSerializer (R7, R8, R9)

```typescript
interface GraphSerializer {
  write(
    nodes: GraphNode[],
    edges: DependencyEdge[],
    outputPath: string
  ): Promise<Result<ParseSuccess, ParseError>>;
}
```

Contract conformance (R7):
- Emit each node per `GraphNode`: non-empty unique string `id`, `kind` ∈ {file, class, function}, string `directoryPath` (R7.1). `definedInFile` present for class/function (equal to an emitted file node id) and **omitted** for file nodes (R7.2). `packagePath` emitted only when non-empty, otherwise **omitted** (R7.3). Field omission (not empty string / null) is how "no value" is represented so the contract's optional-field semantics hold.
- Emit each edge per `DependencyEdge`: `source`, `target`, and the three frequency signals as integers in `[0, 2147483647]` (R7.4). `source`/`target` each equal an emitted node id (R7.5).
- **Final endpoint sweep:** any edge referencing an absent node id is omitted and a diagnostic recorded — no dangling reference is ever emitted (R7.6). (This is a defensive backstop; the Stitcher already guarantees valid endpoints.)
- **Never emit `strength`** — left absent for the downstream weight calculator (R7.7).
- The result loads in the core ingestor with no additions, removals, or renames and zero schema errors (R7.8) — guaranteed by sharing `packages/shared` types.

Single-file, atomic, no-partial write (R8):
- Serialize the entire graph to exactly one file `graph.json`; never split (R8.1).
- Write every node and every edge, counts equal to the in-memory graph, including the zero-node / zero-edge boundary (R8.2, R8.3, R9.7).
- **Atomic write:** serialize the full string in memory, write to a temp file in the same directory, then `fs.rename` over `graph.json`. If serialization or the temp write fails → `output-unwritable`, and no partial/empty `graph.json` is produced; a prior valid file is left untouched because the rename never happens (R8.4, R8.5, R10.6). The output directory being inaccessible is detected before the rename (R8.4).
- On success `graph.json` parses as a single JSON value (R8.6).

Determinism (R9):
- Emit nodes sorted ascending byte-wise lexicographically by `id` (R9.2).
- Emit edges sorted ascending by `(source, target)` pair, `source` primary, `target` tie-break; pairs are unique so the order is total (R9.3).
- No timestamp, wall-clock, run counter, absolute host path, or random value anywhere in the file (R9.4).
- Encode UTF-8 **without BOM**, `\n` line endings, and a **fixed canonical key order** within every object, via a custom stable stringifier in `canonical.ts` (not `JSON.stringify` with default key order). Byte output is fully determined by graph content (R9.6).
- Consequences (verified by tests): identical directory content → identical SHA-256 (R9.1); differing filesystem enumeration order → identical SHA-256 (R9.5).

Canonical key order for emitted objects:
- Node: `id`, `kind`, `packagePath?`, `directoryPath`, `definedInFile?`.
- Edge: `source`, `target`, `importFrequency`, `methodCallFrequency`, `sharedTypeCount`.
- Top level: `nodes`, then `edges`.

### Orchestrator (Parser_System) and error aggregation (R10)

```typescript
interface ParseOptions {
  projectDirectory: string;
  outputPath?: string;   // default: <projectDirectory>/graph.json
}
export function parseProject(options: ParseOptions): Promise<Result<ParseSuccess, ParseError>>;
```

Sequencing:
1. `InputValidator.validate` → on failure return the single error, no further work (R1).
2. `SourceFileCollector.collect` → fatal errors returned immediately (R2.4, R2.5).
3. For each file in canonical order: `AstExtractor.extract`, appending recoverable errors to the `ParseErrorCollector` and continuing (R10.1, R10.2). No output is written yet (R10.3).
4. `SymbolTableBuilder.build` then `Stitcher.stitch` over the full extracted node set.
5. **Gate:** if the collector holds any error, return all of them and write nothing — no partial/empty file, prior file left byte-for-byte intact (R10.4, R10.6).
6. Otherwise `GraphSerializer.write` and return `ParseSuccess`.

Every `ParseError` carries a nature-of-failure message and, where relevant, the file/path involved (R10.5).

## Data Models

### On-disk (`graph.json`) — `RawDependencyGraph`

```jsonc
{
  "nodes": [
    { "id": "class:com.example.UserService", "kind": "class",
      "packagePath": "com.example", "directoryPath": "src/com/example",
      "definedInFile": "file:src/com/example/UserService.java" },
    { "id": "file:src/com/example/UserService.java", "kind": "file",
      "packagePath": "com.example", "directoryPath": "src/com/example" }
  ],
  "edges": [
    { "source": "class:com.example.UserService", "target": "class:com.example.User",
      "importFrequency": 2, "methodCallFrequency": 0, "sharedTypeCount": 0 }
  ]
}
```
(Illustrative; the serializer emits nodes and edges in canonical order — file nodes sort before class nodes only if their ids sort first, which they do not here; ordering is purely by id string.)

### Internal working types (never serialized)

`CollectedFile`, `ExtractionResult`, `RawReference`, and the `(source,target)`-keyed edge accumulator map. These live in `parser/src/types.ts` and are discarded when `parseProject` returns.

## Error Handling

| Condition | Reason | Fatal? | Requirement |
|---|---|---|---|
| null/empty/whitespace path | `no-path-provided` | yes | R1.3 |
| path missing | `path-not-found` | yes | R1.4 |
| path is a file | `path-not-directory` | yes | R1.5 |
| dir unreadable (root) | `directory-unreadable` | yes | R1.6 |
| subdir unreadable during walk | `directory-unreadable` | yes | R2.4 |
| zero `.java` files | `no-java-files` | yes | R2.5 |
| file unreadable | `file-unreadable` | no (continue) | R10.2 |
| file unparseable | `file-unparseable` | no (continue) | R10.1 |
| output location unwritable / mid-write failure | `output-unwritable` | yes | R8.4, R8.5 |

Rules enforced across the board: writing deferred until all parsing completes (R10.3); any recorded error aborts the write, leaving no partial output and any prior valid `graph.json` untouched (R10.4, R10.6); fatal input errors return exactly one error and no output (R1.7); every error names the failure and involved path (R10.5).

## Correctness Properties

These invariants must hold; each is verified by a property-based test (see Testing Strategy) and traces to acceptance criteria.

### Property 1: Determinism (byte-identity)
For any project content, two parse runs — including runs with different filesystem enumeration order — produce `graph.json` with identical SHA-256 digests.

**Validates: Requirements 9.1, 9.5, 9.6**

### Property 2: Content-derived, stable, unique IDs
Every node id is a pure function of the entity's structural attributes; re-deriving is stable across runs, distinct entities never collide, and no counter/timestamp/random/host-path enters an id.

**Validates: Requirements 3.10, 3.11, 3.12, 9.4**

### Property 3: Contract conformance
Every emitted node conforms to `GraphNode` (`kind` ∈ {file, class, function}; `definedInFile` present iff class/function and equals an emitted file id; `packagePath` present iff non-empty); every emitted edge conforms to `DependencyEdge` with exactly the three integer frequency signals in `[0, 2147483647]`, no `strength`.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.7**

### Property 4: Referential integrity
Every edge `source`/`target` references an existing node; no dangling edge is ever emitted; no self-edge; no `function` endpoint.

**Validates: Requirements 5.2, 5.5, 5.6, 7.6**

### Property 5: Edge uniqueness
At most one edge exists per ordered `(source, target)` pair; parallel references collapse into one edge with accumulated frequencies.

**Validates: Requirements 5.3**

### Property 6: Frequency totality and non-negativity
All three signals are finite, non-negative integers; a signal with no contributing reference is exactly `0`.

**Validates: Requirements 6.5, 6.6**

### Property 7: Resolution determinism
Symbol-table collisions resolve to the canonical-first node, and the edge set is independent of file/reference processing order.

**Validates: Requirements 4.5, 4.6, 5.7, 6.7**

### Property 8: Canonical ordering
Emitted nodes are sorted ascending by id; emitted edges are sorted ascending by `(source, target)`.

**Validates: Requirements 9.2, 9.3**

### Property 9: No partial output on error
Any recorded error results in zero bytes written and any pre-existing `graph.json` left byte-for-byte unchanged.

**Validates: Requirements 10.4, 10.6**

### Property 10: Boundary well-formedness
Zero-node and zero-edge projects still emit a well-formed, reproducible single JSON value.

**Validates: Requirements 8.2, 8.3, 8.6, 9.7**

## Testing Strategy

Tooling: `fast-check` (property-based) over `node:test`. Java fixtures live under `fixtures/sample-java-project/` and synthetic in-memory trees drive property tests. The correctness properties below map directly to acceptance criteria.

### Property-based tests (the spec's correctness properties)

1. **Determinism / byte-identity (R9.1, R9.5, R9.6).** For any generated Java project, parsing twice yields identical SHA-256 digests. A second variant shuffles the order files are handed to extraction (simulating filesystem enumeration differences) and still asserts identical digests.
2. **Node-ID stability & uniqueness (R3.10–R3.12).** IDs are pure functions of structure: re-deriving from the same entity gives the same id; distinct entities give distinct ids; no run mixes in counters/time/random (asserted by re-running and diffing).
3. **Contract conformance (R7).** Every emitted node satisfies the `GraphNode` shape (kind in the allowed set, `definedInFile` present iff class/function, `packagePath` present iff non-empty); every emitted edge has exactly the three integer frequency signals in range and no `strength`; every edge endpoint exists in the node set (no dangling references).
4. **Edge de-duplication & no self/function edges (R5.2, R5.3, R5.6).** For any generated reference multiset, the produced edge set has at most one edge per `(source,target)`, no self-edges, and no function endpoints.
5. **Frequency non-negativity & totality (R6.5, R6.6).** All three signals are finite non-negative integers; absent contributions are exactly `0`.
6. **Symbol-table collision determinism (R4.5, R4.6).** Given colliding FQNs, the retained node is always the canonical-first one, regardless of insertion order.
7. **Canonical ordering (R9.2, R9.3).** Emitted node array is sorted by id; edge array is sorted by `(source,target)`.
8. **No partial output on error (R10.4, R10.6).** Injecting an unparseable/unreadable file causes zero writes and leaves any pre-existing `graph.json` byte-for-byte unchanged.

### Example-based / unit tests

- Input validation branches (R1.3–R1.6) with fixture dirs, files, and permission-denied simulations.
- Collector: nested `.java` discovery, `.JAVA` exclusion, symlink skip, empty-project error (R2.2, R2.3, R2.5).
- Extractor: nested/inner types, overload distinction, default-package (`packagePath` omitted), root-file (`directoryPath: ""`) (R3.3, R3.4, R3.6, R3.8).
- Serializer: zero-node and zero-edge boundary emits well-formed, reproducible JSON (R8.2, R8.3, R9.7); atomic-write leaves no temp file on success.
- End-to-end on `fixtures/sample-java-project/`: emitted `graph.json` is loaded by the core ingestor's schema validation with zero errors (R7.8) — a cross-spec integration check gating the parser↔grouping seam.

### Verification harness

A small `verifyDeterminism` test helper parses a project N times and asserts equal SHA-256 across all outputs, used both in property tests and as a manual `npm run` demo aid for Review 1.
