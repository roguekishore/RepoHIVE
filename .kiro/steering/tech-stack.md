# Tech Stack — RepoHIVE

> Always-on context. Project name RepoHIVE (final); commands are placeholders.

## Core stack (final)

| Concern | Choice | Why |
|---------|--------|-----|
| Language | **TypeScript / Node.js** | Enables npx/CLI/MCP/VS Code packaging. (Spring Boot was rejected — it cannot package as an easy CLI.) |
| Parser | **Tree-Sitter** (open-source) | Fast, multi-language ASTs. **Java is the fixed Phase-1 target.** |
| Graph engine | **graphology** | In-memory directed weighted graph; traversal utilities. Acts as our "graph DB" at this scale. |
| Community detection | **Louvain** (Phase 1) behind a `CommunityDetector` interface | Deterministic via seeded PRNG + canonical ordering. **Leiden** swappable later. |
| Frontend | **React + React Flow** | Semantic-zoom viewer ("Google Maps for code"). |
| Storage (core) | **JSON files on disk** | Sufficient at thousands-of-files; no DB needed. |
| Monorepo | **npm workspaces** | Simple, zero extra install. |
| Testing | **fast-check** (property-based) + a unit runner | Verifies the spec's correctness properties. |

## Removed / deferred (do NOT reintroduce without a decision)

- **MySQL — REMOVED** from the stack entirely.
- **Neo4j — DEFERRED to 8th sem** as the graph-native storage/serving option (replaces MySQL), only
  if a hosted service is built. Storage abstracted behind an interface.
- **Embeddings / vector DB** — deferred; semantic layer for search/naming only, never grouping.
- **Cloud (AWS), auth, telemetry** — deferred; ecosystem concerns, not core.

## Notes

- Tree-Sitter Java grammar is the only language binding needed for Phase 1.
- Determinism is a hard requirement: no `Math.random`, no timestamps/counters in IDs; community
  detection runs seeded over canonically-sorted nodes/edges (see core spec design).
- A **Louvain-vs-Leiden** comparison is a good, low-effort paper experiment (the detector is abstracted).
