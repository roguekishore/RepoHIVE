# RepoHIVE web

The Next.js 15 app that hosts RepoHIVE's pages: it mounts the screens from `@repohive/design` and translates the
server's responses onto the design package's contract. The API and the background worker are in `packages/server`.
Everything the user sees is drawn by `packages/design`; this package has no components of its own.

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| UI | `@repohive/design`: tokens, components, screens and canvases (plain CSS custom properties, no CSS framework) |
| Fonts | Host Grotesk through `next/font/google` (a build needs network), Geist Mono from the `geist` package |
| Data | The browser client in `src/features/host` over the API server's endpoints and the published `/r` and `/s` objects |

Light and dark follow the system and can be overridden. To change the look, edit the design package's tokens file; see
`packages/design/README.md`.

## Layout

```
src/
  app/          routes only
                (own)/    the app frame: dashboard, activity, method, account, jobs, repository views
                (bare)/   the landing at / and the sign-in and sign-up pages, without the frame
  features/     host/ (translation layer: browser client, snapshot state, shells), canvas-views/ (route components
                for the five canvas views), repository/ (store helpers)
  lib/          site origin
scripts/        baseline and fidelity capture
```

Tests sit next to the code they cover. `vitest.config.ts` runs two projects: `node` for the middleware and the translation-contract test (the browser
client against the server's real handlers), and `client` (jsdom) for everything else.

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
| `/api/*`, `/healthz`, `/r/*`, `/s/*` | Not served here. The API server answers them (`packages/server`); CloudFront serves `/r` and `/s` when hosted |

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
npm test --workspace @repohive/web   # needs the root build first
```
