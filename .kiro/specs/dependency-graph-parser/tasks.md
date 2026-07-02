# Implementation Plan

## Overview

This plan implements the dependency graph parser (Review 1 deliverable) as the `packages/parser` workspace in the RepoHIVE monorepo, producing a single contract-conforming `graph.json`. Tasks are ordered so the shared JSON contract and deterministic primitives (IDs, canonical ordering) come first, followed by the pipeline stages (validate → collect → extract → symbol table → stitch → serialize → orchestrate), and finish with a determinism harness and an end-to-end fixture test that gates the parser↔grouping seam. Every task is test-first where practical, using `fast-check` over `node:test` for the correctness properties in the design.

## Tasks

- [x] 1. Establish shared JSON contract and parser package scaffolding
  - Create `packages/shared/src/contract.ts` with `NodeId`, `NodeKind`, `GraphNode`, `DependencyEdge`, and `RawDependencyGraph` exactly matching the core spec's Data Models (parser emits only `file`/`class`/`function` and never `strength`).
  - Add `packages/shared` and `packages/parser` `package.json` + `tsconfig.json` extending `tsconfig.base.json`; wire `parser` to depend on `shared`; add `web-tree-sitter`, `tree-sitter-java` (wasm), `graphology`, `fast-check` as dependencies.
  - Add `parser/src/types.ts` (internal working types: `CollectedFile`, `ExtractionResult`, `RawReference`) and `parser/src/errors.ts` (`ParseError`, `ParseErrorReason`, `Result`, `ParseErrorCollector`).
  - _Requirements: 7.1, 7.4, 7.7, 10.5_

- [x] 2. Implement deterministic node-ID scheme and canonical ordering utilities
- [x] 2.1 Implement `parser/src/ids.ts` with content-derived ID builders
  - Build `file:`, `class:` (FQN with `$` nesting), and `func:` (enclosing FQN + `#name(paramTypes)`) id forms from structural attributes only.
  - Assert no counters/timestamps/random/memory/host-paths are used; only forward-slash root-relative paths enter ids.
  - Write property tests: re-deriving the same entity yields the same id; distinct entities yield distinct ids.
  - _Requirements: 3.10, 3.11, 3.12, 9.4_
- [x] 2.2 Implement `parser/src/canonical.ts` ordering and stable stringifier
  - Byte-wise lexicographic comparator for node ids and `(source, target)` edge pairs.
  - Stable JSON stringifier: fixed key order (node: id, kind, packagePath?, directoryPath, definedInFile?; edge: source, target, importFrequency, methodCallFrequency, sharedTypeCount; top-level: nodes then edges), UTF-8 no BOM, `\n` line endings.
  - Write property tests asserting sorted output and byte-identical stringify for equal graphs.
  - _Requirements: 9.2, 9.3, 9.6_

- [x] 3. Implement input validation (`parser/src/input-validator.ts`)
  - Reject null/empty/whitespace path (`no-path-provided`); `fs.stat` for missing (`path-not-found`) and non-directory (`path-not-directory`); `fs.opendir` probe for unreadable (`directory-unreadable`).
  - Complete all validation before any collection; return exactly one error on failure with the offending path.
  - Write unit tests for each branch including permission-denied simulation.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 4. Implement Java source file collection (`parser/src/source-collector.ts`)
  - Recursively discover regular files ending in `.java` (case-sensitive); skip directories, symlinks (not followed), and non-`.java` files without error.
  - Emit `directory-unreadable` fatal error for unreadable subdirectories; emit `no-java-files` when none found.
  - Return `CollectedFile[]` (POSIX root-relative paths) sorted byte-wise lexicographically, independent of enumeration order.
  - Write unit tests: nested discovery, `.JAVA` exclusion, symlink skip, empty-project error; property test for enumeration-order independence.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 9.5_

- [x] 5. Implement AST extraction (`parser/src/ast-extractor.ts`)
- [x] 5.1 Wrap the Tree-Sitter Java grammar and extract nodes
  - Initialize `web-tree-sitter` + Java wasm; parse one file into a transient AST and discard it after extraction.
  - Emit one `file` node; one `class` node per class/interface/enum/record including nested/inner types; one `function` node per method/constructor with overloads distinguished by parameter-type list.
  - Record `packagePath` (dotted, or `""`), `directoryPath` (POSIX, `""` at root), and `definedInFile` for class/function nodes.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.13_
- [x] 5.2 Collect raw references and handle per-file errors
  - Emit `RawReference` records for import declarations (and type-use/method-call where cheaply available).
  - Record `file-unparseable` / `file-unreadable` into the collector and continue with remaining files.
  - Write unit tests: nested/inner types, overloads, default package (packagePath omitted downstream), root file (directoryPath ""), unparseable-file continuation.
  - _Requirements: 3.1, 10.1, 10.2_

- [x] 6. Implement symbol-table construction (`parser/src/symbol-table.ts`)
  - Build FQN→node map: classes by `packagePath.simpleName` (or simple name in default package); functions by `enclosingClassFqn.simpleName`.
  - Resolve collisions deterministically to the canonical-first node; iterate nodes in canonical id order so the map is reproducible; `lookup` returns null for absent keys.
  - Write property tests for collision determinism and build-order independence.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [x] 7. Implement cross-file stitching and frequency signals (`parser/src/stitcher.ts`)
- [x] 7.1 Resolve references into de-duplicated directed edges
  - Resolve each `RawReference` via the symbol table, mapping endpoints to file/class scope; drop unresolved references (no synthetic external nodes).
  - Key edges by `(source, target)`; collapse parallel references into one edge; drop self-edges, function-endpoint edges, and edges with absent endpoints.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
- [x] 7.2 Compute the three frequency signals
  - Accumulate `importFrequency` as count of resolved import references; set `methodCallFrequency` and `sharedTypeCount` (Phase-1: 0 when unresolved); guarantee finite non-negative integers with absent contributions set to exactly 0.
  - Write property tests: edge uniqueness, no self/function edges, frequency totality/non-negativity, processing-order independence.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 8. Implement graph serialization and atomic write (`parser/src/serializer.ts`)
  - Emit nodes/edges conforming to the contract with correct field omission (`definedInFile` for file nodes, `packagePath` when empty), integer frequencies in `[0, 2147483647]`, and no `strength`.
  - Final endpoint sweep drops any dangling edge with a diagnostic; emit in canonical order using the stable stringifier.
  - Atomic write: serialize in memory → temp file in target dir → `fs.rename` to `graph.json`; on any failure return `output-unwritable` with no partial file and prior file untouched.
  - Write unit tests: zero-node/zero-edge boundary well-formedness and reproducibility; no temp file left on success.
  - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.7_

- [x] 9. Implement the orchestrator (`parser/src/orchestrator.ts` + `parser/src/index.ts`)
  - Sequence validate → collect → extract (deferring all writes) → build symbol table → stitch → gate on collector → serialize.
  - Return exactly one error for fatal input failures; return all recorded errors and write nothing when any error was recorded, leaving any prior `graph.json` byte-for-byte intact.
  - Expose `parseProject(options)` with default `outputPath` = `<projectDirectory>/graph.json`.
  - Write unit tests for the error-gate behavior (no partial output; prior file unchanged).
  - _Requirements: 1.7, 10.3, 10.4, 10.6_

- [x] 10. Determinism verification harness and end-to-end fixture test
  - Add `verifyDeterminism` helper that parses a project N times and asserts equal SHA-256 across outputs; use it in property tests and as a `npm run` demo aid for Review 1.
  - Add `fixtures/sample-java-project/` and an end-to-end test asserting the emitted `graph.json` loads under the core ingestor's schema validation with zero errors (parser↔grouping seam).
  - Property tests: byte-identity across runs and across shuffled extraction order.
  - _Requirements: 7.8, 9.1, 9.5, 9.6_

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2.1", "3", "4"] },
    { "wave": 3, "tasks": ["2.2", "5.1"] },
    { "wave": 4, "tasks": ["5.2"] },
    { "wave": 5, "tasks": ["6"] },
    { "wave": 6, "tasks": ["7.1"] },
    { "wave": 7, "tasks": ["7.2"] },
    { "wave": 8, "tasks": ["8"] },
    { "wave": 9, "tasks": ["9"] },
    { "wave": 10, "tasks": ["10"] }
  ]
}
```

## Notes

- **Task 1 blocks everything** — the shared contract and error/result types are prerequisites for all pipeline stages.
- **Wave 2 parallelism:** the ID scheme (2.1), input validation (3), and source collection (4) are independent once the contract exists and can be built concurrently.
- **Deterministic primitives** (2.1 ids, 2.2 canonical order) are consumed by the symbol table, stitcher, and serializer; keep them pure and side-effect free.
- **Main sequential chain:** 5.1 → 5.2 → 6 → 7.1 → 7.2 → 8 → 9, mirroring the runtime pipeline.
- **Task 10 is last** and depends on the full pipeline (Task 9); it provides the Review 1 determinism demo and the parser↔grouping schema check.
- Test-first for correctness properties: each property in the design maps to a `fast-check` test attached to the task that establishes the behavior.
