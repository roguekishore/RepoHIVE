# RepoHIVE server

The API and the background worker, as one plain Node process (no Next.js). `packages/web` serves the pages; this package
answers `/api/*` and `/healthz` (and `/r/*` and `/s/*` in local mode).

## Layout

```
src/
  main.ts       the entry: validates the config, starts the HTTP server and the worker loop
  http/         one file per endpoint (a standard Request in, Response out), router.ts, routes.ts (the endpoint table),
                node-adapter.ts (Node's http to Request/Response, streaming for server-sent events)
  app-db/       SQLite (accounts, sessions, quota charges, indexed repositories)
  auth/         sign-up, sign-in, sessions, origin checks, client address
  quota/ intake/ jobs/ orchestrator/ repositories/ telemetry/ health/
  hosting/      config (every REPOHIVE_* setting), store and ledger clients, local-mode fixtures
  worker/       the 10-second tick: reconcile finished jobs into SQLite, daily SQLite backup
scripts/        start-local (server and web together), seed-local, e2e, run-local-job (the local orchestrator's child)
config/         local.env
```

Source runs as it is: Node 24 strips the TypeScript types, and `scripts/register-aliases.mjs` lets extensionless
relative imports resolve the way the tests do. There is no build step.

## Run

```powershell
npm run seed --workspace @repohive/server          # once: indexes the fixtures into the local store
npm run start --workspace @repohive/server         # API and worker on http://127.0.0.1:3001 (PORT, HOST)
npm run start-local --workspace @repohive/server   # the server and the web dev server together, on :3001 and :3000
npm test --workspace @repohive/server              # includes the HTTP end-to-end script (e2e)
```

## Background worker and SQLite backup

In the same process as the API. It polls the job ledger every 10 seconds, writes finished jobs into `app.sqlite`
(`indexed_repositories`, quota refunds, in-flight cleanup), and once per UTC day runs `VACUUM INTO` and uploads the file to
the artifact store under `backup/app-YYYY-MM-DD.sqlite` (seven daily copies retained).

**Restore:** stop the server, copy the desired backup object from the store to disk (or use
`restoreAppDatabaseFromBackup` in `src/worker/backup.ts` from a small Node script with the same env as the server),
replacing `REPOHIVE_DATA_DIR/app.sqlite`. A `.before-restore` copy of the live file is written beside it. Restart the
server.
