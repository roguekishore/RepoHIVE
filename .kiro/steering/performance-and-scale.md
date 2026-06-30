# Performance & Scale — RepoHIVE

> Always-on context. These are **engineering estimates, not measured benchmarks** — label them as
> such in reviews and the paper until real numbers exist.

## Phase timings — 4,000-file Java repo (~50k edges)

| Phase | Estimate | Dominated by |
|-------|----------|--------------|
| `parse` | ~30s – 2 min | Disk I/O (reading 4,000 files) + cross-file stitching. Parsing itself is negligible (Tree-Sitter is editor-speed). |
| `group` | seconds – ~1 min | Louvain (handles 50k edges easily; runs only on reconstruct regions) + linear ingest/weight/assess/build. |
| `view` | instant per level | Only ~one level (~20 nodes) rendered at a time. Flat baseline is laggy **by design** — that's the point being proven. |

**Full pipeline:** likely **2–5 minutes**, mostly in `parse`. One-time batch job, not a repeated wait.

## File size

- `graph.json`: **~10–20 MB** (IDs + small integers only; no source code, no AST detail).
- Trivially small. `group` loads it in well under a second; working set ~100–300 MB RAM — fine on a
  16 GB laptop, comfortable on a small EC2 instance.

## Scale tiers

| Repo size | Verdict |
|-----------|---------|
| ≤ 5,000 files (target) | Comfortable on a laptop, minutes at most. |
| 5k–50k | Works with tuning (stream parse, bump Node heap, maybe move index/ to a DB). |
| 50k–200k | Needs real engineering (chunked/parallel parse, on-disk graph store, incremental). Future. |
| Millions | Different architecture (distributed). Out of scope. |

## The 5 external factors that drive cost

1. **Edge density** (biggest) — cost scales with edges, not file count.
2. **How tangled** — more reconstruct regions = more community detection.
3. **Language resolution complexity** — Java's explicit imports are tractable; dynamic languages harder.
4. **RAM ceiling** — sets the in-memory graph limit. 16 GB is plenty for thousands of files.
5. **Disk I/O speed** — dominates parse time (reading thousands of files).

## Honest framing for the paper

Validate at the **thousands-of-files** scale (exactly the problem statement's "4,000+ files"). Claim
"scales to thousands of files on commodity hardware" — true and demonstrable. Do NOT claim millions.
