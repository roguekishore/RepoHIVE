import { jsonResponse } from "../auth/http";
import { getJobLedger } from "../hosting/clients";
import { toPublicJob } from "../intake/job-response";


export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  if (jobId === "") {
    return jsonResponse({ code: "BAD_REQUEST", message: "Missing job id." }, { status: 400 });
  }

  const record = await getJobLedger().get(jobId);
  if (record === undefined) {
    return jsonResponse({ code: "NOT_FOUND", message: "Unknown job." }, { status: 404 });
  }

  return jsonResponse(toPublicJob(record), { status: 200 });
}
