# RepoHIVE web

The Next.js 15 app that hosts RepoHIVE: it mounts the screens from `@repohive/design`, translates this server's
responses onto the design package's contract, and holds the server code (accounts, quota, index requests, the
background worker). Everything the user sees is drawn by `packages/design`; this package has no components of its own.

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| UI | `@repohive/design`: tokens, components, screens and canvases (plain CSS custom properties, no CSS framework) |
| Fonts | Host Grotesk through `next/font/google` (a build needs network), Geist Mono from the `geist` package |
| Data | The browser client in `src/features/host` over this server's endpoints and the published `/r` and `/s` objects |

Light and dark follow the system and can be overridden. To change the look, edit the design package's tokens file; see
`packages/design/README.md`.

## Layout

```
src/
  app/          routes only
                (own)/    the app frame: dashboard, activity, method, account, jobs, repository views
                (bare)/   the landing at / and the sign-in and sign-up pages, without the frame
                api/, r/, s/, healthz/   route handlers
  features/     host/ (translation layer: browser client, snapshot state, shells), canvas-views/ (route components
                for the five canvas views), repository/ (URL parsing, default view, store helpers)
  lib/          site origin
  server/       app-db (SQLite), auth, quota, intake, jobs, orchestrator, worker, hosting, telemetry, health,
                repositories, host (translation contract test), views (adapter tests)
scripts/        local launcher, seed, worker entry, end-to-end script
config/         local.env
```

Tests sit next to the code they cover. `vitest.config.ts` runs two projects: `server` (Node) for `src/server` and the
middleware, and `client` (jsdom) for everything else.

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Landing page with the film |
| `/repos` | Dashboard: request an index, indexed repositories as cards |
| `/activity` | The signed-in account's jobs |
| `/method` | How RepoHIVE decides, in long form |
| `/account` | Session and allowance |
| `/jobs/[jobId]` | Follow an index job |
| `/auth/sign-in`, `/auth/sign-up` | Standalone account pages (no frame) |
| `/repos/[owner]/[repo]` | Redirects to `overview` (`DEFAULT_REPO_VIEW`) |
| `/repos/[owner]/[repo]/overview` | The repository in figures (the default view) |
| `/repos/[owner]/[repo]/knowledge-graph` | The Map |
| `/repos/[owner]/[repo]/hierarchy`, `decision-audit`, `architecture` | The built hierarchy and its recorded decisions |
| `/repos/[owner]/[repo]/flat-baseline`, `adaptivity`, `circles` | The flat comparison, the preserve rate, the circle graph |
| `/api/auth/*`, `/api/index`, `/api/jobs/*`, `/api/quota`, `/api/repos`, `/api/repos/[owner]/[repo]`, `/api/account/jobs`, `/healthz` | Route handlers |
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
