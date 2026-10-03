# RepoHIVE web

The Next.js 15 app: the hierarchical repository viewer, the account and index-request routes, and the background
worker. It is the only frontend package; there are no separate UI, types or client packages.

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4 (CSS-first), design tokens in `src/styles/globals.css` |
| Components | Radix primitives with class-variance-authority, in `src/components/ui` |
| Data fetching | SWR over published snapshot objects |
| URL state | nuqs |
| Flat baseline | Sigma, Graphology, ForceAtlas2 |
| Icons, fonts | Lucide React, Geist Sans and Mono |

Dark-first. Every visual token is a CSS custom property in `src/styles/globals.css`.

## Layout

```
src/
  app/          routes only: pages and route handlers
  components/   ui/ primitives, layout/ (navigation, theme), shared/ (page shell, loading state, table)
  features/     one folder per surface
                structure-map  knowledge-graph page: canvas engine, panels, blast-radius worker
                hierarchy      sunburst of the group tree
                decisions      decision model and marks, the audit page's parts
                architecture   level flow, group matrix, determinism panel
                adaptivity     preserve/reconstruct comparison
                flat-baseline  the whole repository as one unstructured graph
                repository     URL parsing, snapshot session, breadcrumb, repository list
                account        sign-in and sign-up, index request, quota
  lib/          cn, theme tokens, site origin
  server/       app-db (SQLite), auth, quota, intake, jobs, orchestrator, worker, hosting, telemetry, health
  styles/       globals.css
scripts/        local launcher, seed, worker entry, end-to-end script
config/         local.env
```

Tests sit next to the code they cover. `vitest.config.ts` runs two projects: `server` (Node) for `src/server` and the
middleware, and `client` (jsdom) for everything else.

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Indexed repositories |
| `/request`, `/jobs/[jobId]`, `/quota` | Request an index, follow its job, see quota |
| `/auth/sign-in`, `/auth/sign-up`, `/auth/sign-out` | Accounts |
| `/repos/[owner]/[repo]/knowledge-graph` | Structure map (the default view) |
| `/repos/[owner]/[repo]/hierarchy`, `decision-audit`, `architecture` | The built hierarchy and its recorded decisions |
| `/repos/[owner]/[repo]/flat-baseline`, `adaptivity` | The flat comparison and the preserve rate |
| `/api/auth/*`, `/api/index`, `/api/jobs/*`, `/api/quota`, `/healthz` | Route handlers |
| `/r/*`, `/s/*` | Published snapshot objects (local store in local mode; CloudFront when hosted) |

## Background worker and SQLite backup

The worker is a separate process from Next.js. In local mode it polls the job ledger every 10 seconds, writes finished jobs into `app.sqlite` (`indexed_repositories`, quota refunds, in-flight cleanup), and once per UTC day runs `VACUUM INTO` and uploads the file to the artifact store under `backup/app-YYYY-MM-DD.sqlite` (seven daily copies retained).

```powershell
npm run worker --workspace @repohive/web
```

**Restore:** stop the app and worker, copy the desired backup object from the store to disk (or use `restoreAppDatabaseFromBackup` in `src/server/worker/backup.ts` from a small Node script with the same env as the app), replacing `REPOHIVE_DATA_DIR/app.sqlite`. A `.before-restore` copy of the live file is written beside it. Restart the app and worker.

## Development

```powershell
# From repo root. Local mode: copy packages/web/config/local.env to packages/web/.env.local,
# seed the fixtures once (npm run seed --workspace @repohive/web), then:
npm run dev --workspace @repohive/web
# Open http://localhost:3000
```

```powershell
npm run type-check --workspace @repohive/web
npm run lint --workspace @repohive/web
npm test --workspace @repohive/web   # needs the root build and `next build` first
```
