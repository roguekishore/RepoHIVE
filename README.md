# RepoHIVE

**Repository Hierarchical Indexing & Visualization Engine**

RepoHIVE turns a large, flat dependency graph into a navigable, multi-level hierarchy — so a developer
or an AI agent can explore a big codebase without having to read all of it at once.

Rather than imposing one grouping strategy everywhere, it measures each region of the codebase and
decides, per region, whether to keep the existing structure or rebuild it from the dependency graph.
Every decision and score is recorded, so a run is reproducible and auditable.

Status: active development. Interfaces and command names are not yet stable.

## License

**GNU Affero General Public License v3.0 or later** — see [`LICENSE`](LICENSE).

Previously distributed under the MIT License; copies obtained under those terms remain under them.
