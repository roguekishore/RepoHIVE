# @repohive/core

The RepoHIVE grouping algorithm: transforms the flat
`graph.json` dependency graph produced by `@repohive/parser` into a navigable
multi-level hierarchy and emits the five-file `index/` set
(`repository.json`, `hierarchy.json`, `nodes.json`, `edges.json`,
`metadata.json`).

## Pipeline

```
graph.json → ingest → weight → assess → adaptively construct → build hierarchy → index/
```

The research core is **adaptive, per-region preserve-vs-reconstruct
construction**: each Primary_Region (Phase 1: a declared Java package, with a
directory fallback) is scored on Cohesion + Coupling (optional Newman
modularity as a secondary signal); regions scoring at or above the
`Structural_Quality_Boundary` keep their boundaries, regions below it are
rebuilt via seeded community detection behind the `CommunityDetector`
interface (Phase 1: Louvain). Every score, decision, confidence value, and
parameter is recorded in `metadata.json`, so runs are deterministic,
auditable, and reproducible.

## Commands (from the repo root)

```
npm run group -- <graph.json | project-dir> [outDir]   # temporary demo wrapper
npm run demo:group-determinism                          # N identical SHA-256 runs
npm run demo:baselines                                  # always-preserve vs always-reconstruct vs adaptive
npm test --workspace @repohive/core                     # property + unit tests (build first)
```

Requirements, design and correctness properties are tracked internally
and are not published.
