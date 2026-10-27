import { getAppDatabase } from "../app-db/database";
import { getAppConfig } from "../hosting/config";
import { checkHealth } from "../health/check-health";


/** Unauthenticated health check with no repository names. */
export async function GET() {
  const config = getAppConfig();
  const db = getAppDatabase();
  const report = await checkHealth(db, config);
  const status = report.status === "ok" ? 200 : 503;
  return Response.json(report, { status });
}
