# RepoHIVE

> **Repository Hierarchical Indexing & Visualization Engine.** A hierarchical codebase indexing engine.

RepoHIVE transforms a large, flat dependency graph (e.g. 4,000+ files) into a navigable, multi-level
hierarchy — **Repository → Groups → Files → Functions** — so both developers and AI agents can explore
large codebases without drowning in a flat tangle of nodes.

The core research contribution is **adaptive, per-region hierarchy construction**: measure each
region's structural quality (cohesion/coupling) and *preserve* well-structured regions or *reconstruct*
messy ones — deterministically and auditably.

## License

MIT
