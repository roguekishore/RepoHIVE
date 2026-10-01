# CLAUDE.md

@AGENTS.md

`AGENTS.md` above is the canonical brief. This file adds only what is specific to Claude Code.

- **`Grep` and `Glob` cannot see `context/`.** Both honour `.gitignore` and report no matches without
  saying they skipped anything. Use `Read` with an explicit path.
- **Claude Code's own memory** (`~/.claude/projects/<slug>/memory/`) is per machine and not committable.
  Treat it as a scratchpad. Anything another agent or machine needs belongs in `context/`, committed.
- **No hooks, custom subagents, skills, or MCP servers are configured.** A reference to any of them is
  stale.
