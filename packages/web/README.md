# RepoHIVE web

Next.js 15 app for RepoHIVE: the hosted request/job flow and the hierarchical repository viewer.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4 (CSS-first), design tokens from `@repohive/ui/styles.css` |
| Components | `@repohive/ui` (Radix primitives, class-variance-authority) |
| Data fetching | SWR |
| Search | cmdk command palette |
| URL state | nuqs |
| Animation | Framer Motion |
| Icons | Lucide React |
| Fonts | Geist Sans + Geist Mono |

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Home |
| `/request`, `/jobs`, `/quota` | Request an index, follow its job, see quota |
| `/auth`, `/settings` | Sign-in and account settings |
| `/repos/[owner]/[repo]` | Repository landing page |
| `/repos/[owner]/[repo]/hierarchy`, `zoom`, `knowledge-graph`, `architecture` | Views of the index |
| `/repos/[owner]/[repo]/adaptivity`, `decision-audit`, `flat-baseline` | Per-region decisions and the flat baseline |
| `/r`, `/s` | Short links |
| `/api/*`, `/healthz` | Route handlers and health check |

### Design System

Dark-mode only. All visual tokens are CSS custom properties in `src/styles/globals.css` — surfaces, borders, text colors, accent blue (`#5B9CF6`), confidence colors (green/yellow/red), language colors for graph nodes, edge type colors, typography scale, spacing grid, radii, and z-index layers. Changing the design means editing one file.

## Background worker and SQLite backup

The worker is a separate process from Next.js. In local mode it polls the job ledger every 10 seconds, writes finished jobs into `app.sqlite` (`indexed_repositories`, quota refunds, in-flight cleanup), and once per UTC day runs `VACUUM INTO` and uploads the file to the artifact store under `backup/app-YYYY-MM-DD.sqlite` (seven daily copies retained).

```powershell
npm run worker --workspace @repohive/web
```

**Restore:** stop the app and worker, copy the desired backup object from the store to disk (or use `restoreAppDatabaseFromBackup` in `src/lib/worker/backup.ts` from a small Node script with the same env as the app), replacing `REPOHIVE_DATA_DIR/app.sqlite`. A `.before-restore` copy of the live file is written beside it. Restart the app and worker.

## Development

```powershell
# From repo root. Local mode: copy packages/web/config/local.env to packages/web/.env.local,
# seed the fixtures once (npm run seed --workspace @repohive/web), then:
npm run dev --workspace packages/web
# Open http://localhost:3000
```

```powershell
# Type check
npm run type-check --workspace packages/web

# Lint
npm run lint --workspace packages/web
```
