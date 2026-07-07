# Project Diary — RepoHIVE (23CS701 – Project-I)

> Reviewer-facing record of **project implementation** progress, organized **by week**.
> Filled from REAL implementation work only — the engine/product (parser, grouping algorithm, viewer,
> blast radius) and the specs that define those deliverables. **Excludes** meta/infrastructure work
> (hooks, steering, the memory vault, PROJECT_STATE/BRAIN upkeep, git setup, naming). No fabricated
> progress. Dates are **week ranges** — fixate the exact start/end dates yourself.

## Team & supervisor

- Team No.: _____
- Members: _____ (Reg. No. _____)
- Supervisor: _____
- Class: IV B.E. CSE | Semester: VII | Academic Year: 2026–2027 (Odd)

## Review dates

| Review | Date |
|--------|------|
| Zeroth | 15.06.2026 |
| First | 03.07.2026 |
| Second | 15.07.2026 |
| Third | 10.08.2026 |

---

## Weekly implementation log

| Week | Dates (start – end) | Implementation work | Supervisor Sign |
|------|---------------------|---------------------|-----------------|
| 1 | _____ – _____ | **Phase-1 Parser (Review 1 deliverable).** Built `packages/shared` (JSON-contract types: `GraphNode`, `DependencyEdge`, `RawDependencyGraph`) and `packages/parser`: Tree-Sitter Java AST extraction of file/class/function nodes, symbol-table construction, cross-file dependency stitching into de-duplicated import edges written to `graph.json`, deterministic content-derived IDs + canonical ordering, a determinism harness (repeated-run SHA-256 check), and a hand-written sample Java fixture. 102 tests passing (property + unit). | |
