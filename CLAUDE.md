# CLAUDE.md

@AGENTS.md

The file above is the canonical, tool-neutral brief: what this project is, the read order, how to work,
commit conventions, environment. **Read it first.** This file adds only what is specific to Claude Code.

## Reading project state

`context/` is a separate private repository cloned into this checkout and git-ignored. It is optional; a
clone without it builds, tests and runs normally.

**Do not try to find it with Grep or Glob.** Both are ripgrep-backed and honour `.gitignore`, so they skip
the whole directory and report no matches without telling you they skipped anything. A file you cannot find
looks exactly like a file that does not exist. `Read` on an explicit path works normally.

So load state by path, in this order:

1. `context/STATE.md`
2. `docs/engineering/*.md`
3. `context/decisions/README.md`, then only the individual decisions that bear on the task

If step 1 fails, the mount is absent. Continue from `docs/engineering/` and say so in your report.

## Session memory

Claude Code's own memory at `~/.claude/projects/<slug>/memory/` is **per machine and not committable**. It
is a scratchpad, not project knowledge. Anything another agent or another machine needs belongs in
`context/`, committed.

## Writing state back

`context/` is its own git repository, so a change there is a separate commit from a change here. `context/README.md`
carries the protocol: what goes in `STATE.md` versus `decisions/` versus `registers/`, and the honesty rules.

Two that are worth repeating because they are easy to violate without noticing:

- **Get the real date before writing one.** Linux/macOS: `date '+%Y-%m-%d %H:%M'`; Windows:
  `Get-Date -Format 'yyyy-MM-dd HH:mm'`. A session can span days, so its start date is not today's date.
- **Never hand-edit `context/decisions/README.md`.** It is generated from frontmatter by `gen-index.py`,
  which also validates as it runs.

## Tooling this project does not use

No hooks, no custom subagents, no skills, and no MCP servers are configured or expected. Earlier tooling
built for a different editor was deliberately dropped rather than ported. If you find a reference to any of
it, the reference is stale.

## Shell

Linux/macOS bash uses `&&` to chain commands; Windows PowerShell uses `;`. Pass a working directory instead
of using `cd` where the tool supports it. Never launch a dev server or watcher as a blocking command; ask
instead.
