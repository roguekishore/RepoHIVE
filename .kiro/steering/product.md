# Product — RepoHIVE

> Always-on context. Project name **RepoHIVE** (Repository Hierarchical Indexing & Visualization
> Engine) — **final**. Commands `parse`/`group`/`view` are **placeholders, not final.**

## What RepoHIVE is

A hierarchical codebase indexing engine. It transforms a large, flat dependency graph (e.g. 4,000+
files, ~50,000 dependencies) into a navigable, multi-level hierarchy:

```
Repository → Level 1 Groups → Level 2 Groups → Files → Functions
```

## The problem

At scale, a flat dependency graph becomes an unreadable tangle — too big to visualize, too large for
an AI agent's context, slow to search. Directory trees don't help: folders show how files were
*saved*, not how code actually *depends* on itself. There is no easy, automatic way to turn the messy
flat map into a clean, layered one that stays simple to explore while preserving every real connection.

## The core research contribution

**Adaptive, per-region hierarchy construction driven by structural quality.** Instead of imposing one
global grouping method, the system measures each region's structural quality (cohesion + coupling) and
decides per region whether to **preserve** existing package/directory boundaries (well-structured) or
**reconstruct** them via dependency-based community detection (poorly-structured). Every decision,
score, and parameter is recorded so the result is deterministic, reproducible, and auditable.

## Two users

1. **Human developers** — onboarding to and navigating a large repo ("Google Maps for code": see the
   big regions, zoom into the one you need, never render all 4,000 nodes at once).
2. **AI coding agents** — retrieving the right context without reading the whole repo (descend the
   hierarchy to load only the relevant branch).

## Our edge (narrow but defensible)

Multi-level **adaptive** hierarchy + **determinism**. This is one genuine idea, well executed — not a
broad "better than everyone" claim.

## The two defense claims (keep them SEPARATE)

- **Claim A — Hierarchy beats flat (for navigation/retrieval).** Why: bounded cognition; a flat pile
  of 40 clusters still overwhelms, a tree shows ~5–7 things per level. Caveat: better for
  *navigation/retrieval*, not a "more accurate" clustering. Robust, easy to demo.
- **Claim B — Adaptive beats single-global (on mixed-quality repos).** Why: real large repos are not
  uniformly structured; global clustering destroys well-designed packages; adaptive preserves
  measured-good regions and rebuilds only messy ones. Caveat: a **hypothesis to prove, not a theorem**;
  wins on *mixed* repos. Graceful degradation: never worse than global, strictly better on mixed.

## Honest caveats (state these openly — they build credibility)

- Blast radius is *static* reachability; it misses dynamic dependencies (reflection, DI, string
  lookups — common in Java/Spring) and may under-count.
- Token savings: a graph-over-raw-files saving is shared with existing tools (table stakes); our
  *incremental* hierarchy-over-flat-graph saving is real but smaller — measure it, don't claim "71x".
- We will NOT be "better than Sourcegraph/Graphify overall" — only better in our one narrow slice.

## What is explicitly OUT of core scope

Intent detection, automatic flow naming, repository semantic understanding, LLM-generated architecture
decisions, and **embedding-based grouping**. (Embeddings may be added later as a semantic layer for
search/naming — never for grouping.)
