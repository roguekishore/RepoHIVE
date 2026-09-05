# RepoHIVE — Fable Handoff

You are working on the RepoHIVE codebase. Read deeply before touching anything.

## Step 1 — Read these files in order

1. `AGENTS.md` — the rules of this repo
2. `context/STATE.md` — where the project is now
3. `docs/engineering/architecture.md`
4. `docs/engineering/conventions.md`
5. `docs/engineering/stack.md`
6. `docs/engineering/verification.md`
7. `context/registers/cli.md` — every CLI decision made so far
8. `context/registers/seams.md` — the four seams, what blocks what, why retrofitting is safe
9. `context/registers/workstreams.md` — full dependency and parallelism map
10. `context/decisions/README.md` — decision index; open individual files only as needed

**Do not Grep or Glob inside `context/`.** It is gitignored and those tools skip it silently with no
warning. Read every `context/` file by explicit path only.

---

## Step 2 — Understand your design authority

You own the design for the following. These are inputs and constraints, not a detailed spec — figure
out the best shape.

**`packages/engine` — the orchestration package**
- Public API: one async call that runs parse then group
- Dependency injection shape — follow the house pattern (`fn(options, deps = defaultDeps())`)
- Result types, including `parseSkipped: boolean`, `durationMs: { parse, group, total }`,
  and `concurrency?: number` on options (internal, not a CLI flag in v1)
- Hard constraint: callers must stay compatible when swapping local-disk sources for future cloud
  sources. The seam must be designed with that in mind from day one, even though cloud is not v1 scope.
- Lives in `packages/engine`, not inside `packages/cli`. The MCP server will import it directly;
  a package named "cli" is wrong there.

**MCP tool surface (`packages/mcp`)**
- Decide which tools agents actually need
- Design the schema for each tool
- No new engine exports are required — `parseIndex` and `analyzeBlastRadius` are already exported
  from `@repohive/core`

---

## Step 3 — Decisions already final; do not reopen

| Area | Decision |
|------|----------|
| Command names | `index` / `parse` / `group` / `view`. `describe` deferred. |
| Output directory | `.repohive/` by default, `--out` to override |
| Packaging | Publish unbundled at `0.1.0`. Four packages: `@repohive/shared`, `@repohive/parser`, `@repohive/core` as libraries plus `repohive` as the CLI. CLI depends on the three. |
| Stage 1 | Ships without the viewer. `index` + `--json` is an acceptable first publish. |
| Versioning | Lockstep — all four packages share one version and move together. |
| Viewer (CLI) | Hierarchical viewer only, ~300–500 KB single `.html`, Vite + `vite-plugin-singlefile`. Stage 2. |

---

## Step 4 — Parallel execution

**Spawn one subagent per branch. Do not work sequentially.**

Branches `wip/test-fix`, `wip/credibility`, `wip/mcp`, and `wip/engine` have zero file overlap and
start simultaneously. `wip/cli` starts only after `wip/engine`'s public API is stable — verified by
build, not by Agent 4's word alone.

### Agent assignments

| Agent | Branch | Reads | Owns |
|-------|--------|-------|------|
| 1 | `wip/test-fix` | `docs/engineering/verification.md` | Fix `node --test` so the engine test suite runs correctly on both Node 20 and Node 21+. The current glob form fails on Node 20; the bare `dist/` form is silently vacuous on Node 21+. |
| 2 | `wip/credibility` | `context/STATE.md` | Three items: re-index `fixtures/sample-java-project` (currently 0/8 group provenance coverage); fix the landing page zeros (currently shows `Total Pages 0` etc.); remove the two dead controls on the Knowledge Graph page. |
| 3 | `wip/mcp` | `context/registers/workstreams.md` (the MCP section), `docs/engineering/architecture.md` | `packages/mcp`, read-only v1. Import `@repohive/core` directly — no new engine exports needed. Design the tool surface; document the schema decisions. |
| 4 | `wip/engine` | `context/registers/seams.md`, `context/registers/cli.md`, all `docs/engineering/*` | Design and implement `packages/engine`. When `packages/engine/src/index.ts` is committed and `npm run build --workspace @repohive/engine` exits 0, signal the orchestrator so Agent 5 can start. |
| 5 | `wip/cli` | `context/registers/cli.md` | Starts **only after the orchestrator verifies** `wip/engine` builds cleanly. `packages/cli`: move both existing wrappers in, fix `INIT_CWD → process.cwd()`, fix the self-execution guard, harden `parse-cli.ts` to match `group-cli.ts`, add `--json`. |

### Synchronization rules

- **`wip/cli` gate:** before spawning Agent 5, the orchestrator must independently verify
  `npm run build --workspace @repohive/engine` exits 0 on the `wip/engine` branch. Do not take
  Agent 4's report as sufficient — run the build check.
- **`context/` writes serialize:** the orchestrator owns all `context/` commits. Individual agents
  produce their state and decision content and hand it to the orchestrator, which applies them one at
  a time. Agents do not commit to `context/` directly.
- Code branches never overlap; no coordination is needed between agents for source files.

---

## Step 5 — Decision logging

Any design choice that binds future work must be recorded.

1. Create `context/decisions/YYYY-MM-DD-<slug>.md` with complete frontmatter
   (`date`, `slug`, `title`, `status`, `summary`, plus `supersedes`/`superseded_by` if relevant)
2. Regenerate the index: `python context/gen-index.py context/decisions`
3. Before committing anything under `context/`, run: `bash context/gate.sh .`
   — expected baseline: **3 hits in 2 known locations**. Anything outside those two locations is a
   real hit and must be adjudicated before committing.

Never hand-edit `context/decisions/README.md` — it is generated.

---

## Step 6 — Verification gates

Before reporting any stream complete, run every gate required by
`docs/engineering/verification.md`. That file says which gates run from which checkout and what the
known failures are. A gate you did not actually execute does not count as passing. State explicitly
which gates ran and which could not.

---

## Step 7 — State updates

After meaningful progress in each stream, rewrite `context/STATE.md` in place. Keep it current.
Do not append, annotate, or strike through — rewrite the relevant section. The orchestrator applies
these writes serially.

---

## Step 8 — Git policy

- Push freely to `wip/*` branches — that is expected.
- **Never commit directly to `main` or `feat/*`.**
- **Never merge branches, create tags, or push to `main`** — those are owner-driven operations.
- One commit per observable sub-behaviour, each independently building and passing.
- Commit types for `context/`: `decision:`, `state:`, `register:`. For code: `feat`, `fix`, `test`,
  `refactor`, `perf`, `chore`. Always lowercase, imperative, no trailing period, under ~70 characters.
- Never `git add .` — stage explicit paths.
- Get the real date before stamping anything:
  Linux/macOS: `date '+%Y-%m-%d %H:%M'` · Windows: `Get-Date -Format 'yyyy-MM-dd HH:mm'`
