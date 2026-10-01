import { getAppDatabase } from "@/lib/app-db/database";
import { getAppConfig } from "@/lib/hosting/config";
import { checkHealth } from "@/lib/health/check-health";

export const dynamic = "force-dynamic";

/** Unauthenticated health check with no repository names. */
export async function GET() {
  const config = getAppConfig();
  const db = getAppDatabase();
  const report = await checkHealth(db, config);
  const status = report.status === "ok" ? 200 : 503;
  return Response.json(report, { status });
}
