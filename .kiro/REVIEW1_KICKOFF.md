# Review 1 Kickoff — Parser Spec

> A one-time guide for starting Review-1 work (Parser, due 03.07.2026). Covers how to create the
> `dependency-graph-parser` spec. (Git methodology is handled separately — see a future git setup
> session.) After the spec is approved, normal spec-driven development begins.

---

## Instructions to create the parser spec

The agent creates the spec for the feature **`dependency-graph-parser`** under
`.kiro/specs/dependency-graph-parser/`, in three approved stages. Do NOT write parser code until all
three are approved (spec-driven rule).

### Step 1 — `requirements.md`
- Follow the **same rigorous style** as the existing `hierarchical-repository-grouping` spec
  (Introduction, Glossary, numbered Requirements with EARS-style acceptance criteria).
- Scope for Review 1 (per `review-timeline.md` and the agreed decision):
  - **Input:** a path to a local Java project directory.
  - **Process:** parse each `.java` file with Tree-Sitter (per-file AST), then **stitch** ASTs into a
    single cross-file dependency graph.
  - **Output:** one `graph.json` conforming **exactly** to the JSON contract in
    `steering/architecture.md` / the core spec (`GraphNode`, `DependencyEdge`).
  - **Nodes:** files, classes, functions (with `packagePath`, `directoryPath`, `definedInFile`).
  - **Edges:** import edges (file→file / class→class). Each edge carries `importFrequency`,
    `methodCallFrequency`, `sharedTypeCount`.
  - **Phase-1 simplification (explicit):** frequency signals may start as simple counts
    (e.g. import count; call/shared-type may start at 0 or a basic count) — the **shape is correct
    from day one**, richness sharpens later. State this as an explicit scope note.
  - **Determinism:** identical input → identical `graph.json` (canonical ordering; no timestamps).
  - **Error handling:** missing path, non-Java files, unparseable file → clear errors, no partial junk.
- Keep it honest and scoped: it is a **parser**, not the grouping algorithm.

### Step 2 — `design.md`
- Target **TypeScript / Node.js**; use the Tree-Sitter Java grammar binding and `graphology` for the
  in-memory graph (matching `tech-stack.md`).
- Document: the AST-walk strategy, how cross-file references are resolved (the "stitching"), the
  symbol table, the node/edge construction, and how output maps to the JSON contract.
- Reuse the contract types from `packages/shared` (define them there if not yet present).
- Include a small worked example (a 2–3 file Java snippet → resulting nodes/edges) for clarity.
- Note the determinism strategy (sorted iteration, stable IDs).

### Step 3 — `tasks.md`
- Numbered, actionable coding tasks, each referencing the requirements it satisfies.
- Suggested ordering: (1) `packages/shared` contract types → (2) parser scaffold + Tree-Sitter wiring
  → (3) per-file AST extraction (nodes) → (4) cross-file stitching (edges) → (5) frequency counts
  → (6) serialize `graph.json` → (7) run on the sample repo + verify shape.
- Each task small enough for one commit.

### Prerequisites the agent should confirm first
- **Node.js + npm** installed (parser runtime). Confirm version.
- A **sample Java repo** placed at `fixtures/sample-java-project/` (small open-source project).
- `npm install` of parser dependencies once `package.json` lists them.

### After the spec is approved
- Update `PROJECT_STATE.md`: move the spec item to Done, set the next action to "execute parser tasks."

---

## Summary checklist

- [ ] Create `dependency-graph-parser/requirements.md` → approve
- [ ] Create `design.md` → approve
- [ ] Create `tasks.md` → approve
- [ ] Confirm Node.js installed; place sample Java repo in `fixtures/sample-java-project/`
- [ ] Execute parser tasks
- [ ] Prepare the deck (rubric: domain, lit survey, problem, architecture diagram, presentation, communication)

> Git setup and branch methodology are intentionally out of scope here — handled in a separate session.
