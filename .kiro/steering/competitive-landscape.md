# Competitive Landscape — RepoHIVE

> Always-on context. Be honest and precise here — this is what survives a sharp reviewer.

## Graphify (the key prior art)

- ~63K GitHub stars, YC-backed, PyPI package `graphifyy`. NOT sleepy or obscure.
- Pipeline: Tree-Sitter ASTs → NetworkX graph → **single global Leiden clustering** → exports
  `graph.json` + interactive HTML + a report. SHA256 cache for incremental re-runs.
- Already has: **MCP server** (query_graph/get_node/get_neighbors/shortest_path), **Neo4j export**,
  incremental/watch mode, git hooks, and a **skill** that installs across 10+ AI assistants.
- **Clusters by graph topology with NO embeddings** — independent validation that our structural-first
  approach is sound. *(Content rephrased from Graphify's README for licensing compliance;
  source: github.com/safishamsi/graphify.)*

## Our narrow, defensible edge vs Graphify

1. **Multi-level ADAPTIVE hierarchy** vs their single global clustering. Their flat pile of communities
   IS the "single global strategy" our spec names as the research gap.
2. **True navigable multi-level hierarchy** (semantic zoom) vs their flat-ish HTML graph.
3. **Determinism + auditability** first-class vs their LLM-inferred (non-deterministic) edges.

## Table stakes (NOT novelty — do not imply otherwise)

Tree-Sitter parsing, the dependency graph, MCP server, Neo4j export, incremental indexing, watch mode.
Graphify already has all of these. Our innovation budget is spent on the **algorithm and the hierarchy**.

## Sourcegraph

Broad code search/intelligence at enterprise scale (hundreds of engineers, years of work). We will NOT
be "better overall." We can be better in our **one narrow slice**: deterministic adaptive hierarchical
navigation. Never conflate "better at our slice" with "better tool."

## Naming

The project name is **RepoHIVE** (Repository Hierarchical Indexing & Visualization Engine) — chosen to
be distinct from **Graphify** (taken, popular, quasi-branded).

## Distribution insight

The **skill** is how Graphify spread (63K stars). It is the highest-ROI, lowest-effort distribution
path (a markdown instruction file over the CLI) — our primary viral lever IF we pursue Path 2 later.
Virality is distribution + timing + luck, NOT algorithm quality. A better algorithm does not cause
virality.
