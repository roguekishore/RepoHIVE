# Review Timeline — RepoHIVE

> Always-on context. 7th semester (23CS701 – Project-I).

## Dates

| Review | Date | Beat |
|--------|------|------|
| Zeroth | **15.06.2026** | Proposal (done) |
| First | **03.07.2026** | Parser |
| Second | **15.07.2026** | Algorithm |
| Third | **10.08.2026** | Viewer + baseline |

> First → Second is only **12 days**; Second → Third is **26 days**. Keep per-review scope modest.

## Three-beat arc (Problem → Solution → Payoff)

- **Review 1 (Jul 3) — Parser.** `parse` → `graph.json`. Demo: show the JSON (nodes + edges).
  Message: *"Here's the raw flat dependency graph. Flat doesn't scale — here's the evidence."*
- **Review 2 (Jul 15) — Algorithm.** `group` → `index/`. Demo: same repo organized into
  Repository → Groups → Files → Functions + metadata showing preserve-vs-reconstruct decisions.
  Message: *"The flat tangle becomes a navigable hierarchy, automatically and reproducibly."*
  **Safety valve:** if the parser isn't ready, run `group` on a synthetic hand-made `graph.json`
  (same schema — the algorithm doesn't care where the graph came from).
- **Review 3 (Aug 10) — Viewer + baseline.** `view`. Demo: semantic-zoom web view side-by-side with
  the flat 4,000-node baseline; optional first blast-radius query (light up impacted regions in red).
  Message: *"Flat is unusable; hierarchical is navigable — here's the visible proof."*

## Reframe (dissolves the "CLI is 8th sem" worry)

Demoing the engine ≠ having a packaged CLI. In 7th sem we demo via `npm run` scripts; packaging
(CLI/skill/MCP/extension) is 8th-sem distribution. The functionality exists early; the shrink-wrap
comes later.

## Official rubric (mark ALL six in every deck)

| Criterion | Marks |
|-----------|-------|
| Domain Knowledge | 20 |
| Literature Survey | 20 |
| Problem Definition | 20 |
| Proposed Architecture (block diagram — concise + clear) | 20 |
| Organization of Presentation | 10 |
| Communication Skill | 10 |

Implication: every review deck needs a clear domain intro, the literature survey + motivation, a sharp
problem definition, and a **concise, clear block diagram** of the proposed system.

## 8th semester (reviews 4–6, Sep+)

Packaging (skill + MCP + VS Code extension), full evaluation metrics, scaling, and the paper
(0% plagiarism — write from `docs/research-log.md`, cite all 10 reference papers).
