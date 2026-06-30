# Roadmap — RepoHIVE

> Always-on context. Everything here is **deferred, not forgotten.** Each item has a seam so it plugs
> in later without engine rework. Do NOT build these early.

## Strategy: Path 1 now, Path 2 deferred

- **Path 1 (CHOSEN):** final-year project + paper. Scoped, achievable on minimal daily time, novel
  core, low risk. This is what we build now.
- **Path 2 (DEFERRED, door kept open):** viral / commercial. A *distribution* game (~80% hustle,
  ~20% tech), NOT an algorithm game. Pursue after graduation if the fire's still there. Do NOT enhance
  the algorithm "to go viral" — wrong lever.

## Deferred items

| Item | Why deferred | Seam / how it plugs in | When |
|------|--------------|------------------------|------|
| **Embeddings** | Subjective; would blur the deterministic thesis | Semantic layer ON TOP for search + cluster naming; never grouping | 8th sem / optional |
| **Neo4j** | Not needed at thousands-of-files | Storage abstracted behind interface | 8th sem (if hosted service) |
| **Cloud (AWS)** | Tool is local-first | Hosted demo/service wraps the engine | 8th sem / optional |
| **Auth** | Only for hosted multi-user service | Lives with hosted service | 8th sem+ |
| **Telemetry** | Adoption counting without auth | Opt-in anonymous, separate from engine | Future |
| **Skill packaging** | Highest-ROI distribution (Graphify's viral path); cheap (markdown over CLI) | `install` drops SKILL.md into assistant config; rides on CLI + self-describing JSON | 8th sem / Path-2 priority |
| **MCP server** | Distribution wrapper | Reads index/ JSON; exposes query_graph/get_node/get_neighbors/shortest_path | 8th sem |
| **VS Code extension** | Distribution wrapper | Wraps CLI + viewer | 8th sem (last) |
| **Multi-language parsing** | Java-first keeps Phase 1 tractable | Parser data model already general | Future, if low-effort |
| **Incremental / watch / parallel parse / caching** | Performance/UX, not novelty | Around the engine | Future (ecosystem parity) |
| **Architectural drift detection** | Needs stable hierarchy first | Reads index/ over time | Future research |
| **Custom Kiro agents** (reviewer, paper, diary, spec) | No recurring work yet | Create when the matching work begins | When needed |
| **Commercialization** | Different game; risks degree | Engine + contract + wrappers keep door open | After graduation |

## How room is protected (the 3 principles)

1. **The JSON contract is the universal seam** — any consumer plugs in through it.
2. **Interfaces over implementations** — new capability = new implementation behind an existing
   interface (e.g. `CommunityDetector`, storage interface), not a rewrite.
3. **Engine vs ecosystem split** — optional features layer outside the pure local engine.

## UI/UX, branding, explainer video

Presentation-layer topics. Deferred to a dedicated session AFTER the doc backbone is complete. They do
not change the engine or specs.
