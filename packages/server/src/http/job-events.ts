import { randomUUID } from "node:crypto";
import { getClientIp } from "../auth/client-ip";
import { jsonResponse } from "../auth/http";
import { getAppConfig } from "../hosting/config";
import { getJobLedger } from "../hosting/clients";
import { createJobEventsStream } from "../jobs/job-events-stream";
import { tryRegisterJobEventStream } from "../jobs/stream-registry";


export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  if (jobId === "") {
    return jsonResponse({ code: "BAD_REQUEST", message: "Missing job id." }, { status: 400 });
  }

  const config = getAppConfig();
  const ip = getClientIp(request, config);
  const streamId = randomUUID();
  if (!tryRegisterJobEventStream(ip, streamId)) {
    return jsonResponse({ code: "TOO_MANY_STREAMS", message: "Too many open progress streams." }, { status: 429 });
  }

  const ledger = getJobLedger(config);
  const stream = createJobEventsStream(ledger, jobId, ip, streamId, request);
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
