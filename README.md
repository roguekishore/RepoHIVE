# RepoHIVE

> **Repository Hierarchical Indexing & Visualization Engine.** A hierarchical codebase indexing engine.

RepoHIVE transforms a large, flat dependency graph (e.g. 4,000+ files) into a navigable, multi-level
hierarchy — **Repository → Groups → Files → Functions** — so both developers and AI agents can explore
large codebases without drowning in a flat tangle of nodes.

The core research contribution is **adaptive, per-region hierarchy construction**: measure each
region's structural quality (cohesion/coupling) and *preserve* well-structured regions or *reconstruct*
messy ones — deterministically and auditably.

## License

**GNU Affero General Public License v3.0 or later** (`AGPL-3.0-or-later`). See [`LICENSE`](LICENSE).

    RepoHIVE - a hierarchical codebase indexing engine.
    Copyright (C) 2026 Kishore N E

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

RepoHIVE was previously distributed under the MIT License. It is relicensed under the AGPL-3.0
because its viewer is built on the user-interface packages of
[repowise](https://github.com/repowise-dev/repowise), which are licensed AGPL-3.0. Copies obtained under the earlier MIT terms remain
under those terms; everything from this point forward is AGPL-3.0-or-later.

Per-file copyright notices and upstream attribution for vendored code are recorded in `NOTICE`
(added with the vendored packages).
