# RepoHIVE web

The RepoHIVE viewer: a static single-page app (Next.js 15 `output: "export"`, React 19). `next build` writes plain
files to `out/`; a host serves them. There is no Node server here. Accounts, index requests, jobs, the repository
list and the published snapshot objects are all answered by the separate Java server (`repohive-server/`), which
this app reaches over `/api/...` and `/artifacts/...`.

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router, static export), React 19, TypeScript |
| Styling | Tailwind CSS v4 (CSS-first), design tokens in `src/styles/globals.css` |
| Components | Radix primitives with class-variance-authority, in `src/components/ui` |
| Data fetching | SWR over the server's API and the published snapshot objects |
| URL state | nuqs |
| Flat baseline | Sigma, Graphology, ForceAtlas2 |
| Icons, fonts | Lucide React, Geist Sans and Mono |

Dark-first. Every visual token is a CSS custom property in `src/styles/globals.css`.

## Layout

```
src/
  app/          routes only: pages and layouts
  components/   ui/ primitives, layout/ (navigation, theme), shared/ (page shell, loading state, table)
  features/     one folder per surface
                structure-map  knowledge-graph page: canvas engine, panels, blast-radius worker
                hierarchy      sunburst of the group tree
                decisions      decision model and marks, the audit page's parts
                architecture   level flow, group matrix, determinism panel
                adaptivity     preserve/reconstruct comparison
                flat-baseline  the whole repository as one unstructured graph
                repository     URL parsing, the repository shell, snapshot session, breadcrumb, repository list
                jobs           the public job shape and the job page's path parsing
                account        sign-in and sign-up, sidebar account panel, index request, quota dialog
  lib/          cn, theme tokens, site origin, use-mounted
  views/        tests of the @repohive/views adapters
  styles/       globals.css
scripts/        start-local (the local launcher) and the end-to-end script
```

Tests sit next to the code they cover. `vitest.config.ts` runs two projects: `views` (Node) for `src/views`, and
`client` (jsdom) for everything else.

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Dashboard: request an index, indexed repositories as cards (`GET /api/repos?page=<n>`) |
| `/jobs/<jobId>` | Follow an index job (`GET /api/jobs/<id>`, SSE `/api/jobs/<id>/events`) |
| `/auth/sign-in`, `/auth/sign-up` | Standalone account pages (no sidebar) |
| `/repos/<owner>/<repo>` | Redirects (client side) to `knowledge-graph` |
| `/repos/<owner>/<repo>/knowledge-graph` | Structure map (the default view) |
| `/repos/<owner>/<repo>/hierarchy`, `decision-audit`, `architecture`, `circles` | The built hierarchy and its recorded decisions |
| `/repos/<owner>/<repo>/flat-baseline`, `adaptivity` | The flat comparison and the preserve rate |

Data: `GET /api/repos/<owner>/<repo>` once per page session names the snapshot; every view then reads
`/artifacts/<owner>/<repo>/<snapshotId>/<path>`. `?snapshot=<id>` pins a snapshot (checked against its
`manifest.json`).

## Run locally

```bash
# once: build the server jar
(cd repohive-server && ./mvnw -q package -DskipTests)

# every time: from the repo root
npm run start-local --workspace @repohive/web
# open http://localhost:3000
```

`scripts/start-local.mjs` starts the Java server (`java -jar target/repohive-server.jar`, working directory
`repohive-server/`, which reads `repohive-server/config/local.env` itself) and `next dev --port 3000`. In development
`next.config.ts` proxies `/api`, `/artifacts` and `/healthz` to `REPOHIVE_API_ORIGIN` (default
`http://127.0.0.1:8080`) and applies the host mapping below with rewrites. Ctrl-C stops both.

```bash
npm run type-check --workspace @repohive/web
npm run lint --workspace @repohive/web
npm test --workspace @repohive/web
npm run build --workspace @repohive/web      # writes out/
```

## Static export and host mapping

`/repos/[owner]/[repo]/...` and `/jobs/[jobId]` have arbitrary values that a static export cannot pre-render. Each
dynamic route exports `generateStaticParams()` with one placeholder (`owner: "_"`, `repo: "_"`, `jobId: "_"`) and
`dynamicParams = false`. Nothing renders from `params`: the shell (`src/features/repository/repo-shell.tsx`, and the
job page) renders a neutral loading state until mounted, then reads the owner, repo, surface and job id from the
browser path (`usePathname()`). The same shell applies the old middleware rules on the client: a name GitHub would
not allow shows the not-found page, uppercase owner or repo `router.replace`s to the lowercase URL (rest of the path and
query kept), and the bare repository URL `router.replace`s to `/repos/<owner>/<repo>/knowledge-graph`.

So the host must serve the placeholder files for real paths. `next build` produces, among others:

```
out/index.html            out/index.txt
out/404.html
out/auth/sign-in.html     out/auth/sign-in.txt        (same for sign-up)
out/jobs/_.html           out/jobs/_.txt
out/repos/_/_.html        out/repos/_/_.txt           (the bare repository page)
out/repos/_/_/<surface>.html   out/repos/_/_/<surface>.txt
        <surface> = knowledge-graph | hierarchy | decision-audit | architecture | circles | flat-baseline | adaptivity
out/_next/static/...      (hashed assets; immutable)
```

The `.html` files are the pages. The `.txt` files are the RSC payloads the client router fetches on soft
navigation and prefetch. In the exported build the router requests `<path>.txt?_rsc=<hash>` (or `<path>/index.txt`
for a path ending in `/`, e.g. `/index.txt` for the dashboard) with the request header `RSC: 1`.

### Rules (apply in this order)

Let a "payload request" be a request that has the `RSC: 1` header (or a `_rsc` query parameter). A request for a
repository named `foo.txt` is therefore told apart from the payload of `foo`: only a payload request has `.txt`
stripped from the last path segment.

For a payload request, first remove a trailing `/index.txt` (leaving `/`) or `.txt` from the path, then apply rules 1 to
3 with `.txt` as the extension below. Otherwise the extension is `.html`.

1. `/repos/<owner>/<repo>` or `/repos/<owner>/<repo>/` (any owner and repo, including invalid names) serves
   `repos/_/_<ext>`.
2. `/repos/<owner>/<repo>/<surface>` (one segment after the repo) serves `repos/_/_/<surface><ext>` if that file
   exists; otherwise `404.html` with status 404.
3. `/jobs/<jobId>` (one segment) serves `jobs/_<ext>`.
4. Anything else: the exact file; else `<path>.html`; else `<path>/index.html`; else `404.html` with status 404.
   (`/` is `index.html`; `/_next/static/...` and `/icon.png` are exact files.)

Paths under `/api/`, `/artifacts/` and `/healthz` are the server's and never reach these rules. Responses for
`/repos/...` and `/jobs/...` and every `.html` and `.txt` file should be `Cache-Control: no-cache`; `/_next/static/`
is immutable.

Three places implement this mapping: the Java server's local mode (when `REPOHIVE_WEB_DIR` is set), Caddy in AWS,
and `next dev` (`rewrites()` in `next.config.ts`, development only; `/repos/:owner/:repo` to `/repos/_/_`,
`/repos/:owner/:repo/:surface` to `/repos/_/_/:surface`, `/jobs/:jobId` to `/jobs/_`).
