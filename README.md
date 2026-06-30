# RepoHIVE

> **Repository Hierarchical Indexing & Visualization Engine.** A hierarchical codebase indexing engine.

RepoHIVE transforms a large, flat dependency graph (e.g. 4,000+ files) into a navigable, multi-level
hierarchy — **Repository → Groups → Files → Functions** — so both developers and AI agents can explore
large codebases without drowning in a flat tangle of nodes.

The core research contribution is **adaptive, per-region hierarchy construction**: measure each
region's structural quality (cohesion/coupling) and *preserve* well-structured regions or *reconstruct*
messy ones — deterministically and auditably.

## Pipeline

```
Java repo  →  parse  →  graph.json  →  group  →  index/*.json  →  view  →  interactive viewer
```

## Monorepo layout

```
packages/
  shared/   JSON-contract types (the stable seam)
  parser/   Tree-Sitter → graph.json
  core/     grouping algorithm + blast radius
  cli/      wires the pipeline
  web/      React + React Flow viewer
```

## Project context

Final-year project (23CS701 – Project-I), built spec-driven with Kiro. See `.kiro/PROJECT_PLAN.md` for
the full plan and `.kiro/steering/` for durable context. Commands `parse`/`group`/`view` are placeholders.

## License

MIT
