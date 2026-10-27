/**
 * The server process: the HTTP API and the background worker in one Node process.
 *
 *   PORT (default 3001), HOST (default 127.0.0.1), and the REPOHIVE_* settings in hosting/config.ts.
 */
import { createServer } from "node:http";
import { getAppDatabase } from "./app-db/database";
import { getArtifactStore, getJobLedger } from "./hosting/clients";
import { getAppConfig } from "./hosting/config";
import { validateConfigAtStartup } from "./hosting/startup";
import { createNodeListener } from "./http/node-adapter";
import { createRouter } from "./http/router";
import { ROUTES } from "./http/routes";
import { startWorker } from "./worker/run";

validateConfigAtStartup();
const config = getAppConfig();
const db = getAppDatabase();

const port = Number(process.env.PORT ?? "3001");
const host = process.env.HOST ?? "127.0.0.1";
const server = createServer(createNodeListener(createRouter(ROUTES), { localMode: config.mode === "local" }));
server.listen(port, host, () => {
  console.log(JSON.stringify({ level: "info", msg: "server listening", host, port, mode: config.mode }));
});

const stopWorker = startWorker(config, db, getJobLedger(config), getArtifactStore(config));

function shutdown(): void {
  stopWorker();
  server.close(() => process.exit(0));
  server.closeAllConnections();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
