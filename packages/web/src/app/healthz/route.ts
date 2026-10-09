import { getAppDatabase } from "@/server/app-db/database";
import { getAppConfig } from "@/server/hosting/config";
import { checkHealth } from "@/server/health/check-health";

export const dynamic = "force-dynamic";

/** Unauthenticated health check with no repository names. */
export async function GET() {
  const config = getAppConfig();
  const db = getAppDatabase();
  const report = await checkHealth(db, config);
  const status = report.status === "ok" ? 200 : 503;
  return Response.json(report, { status });
}
