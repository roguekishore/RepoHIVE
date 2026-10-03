/**
 * hosting-3 Requirement 4.4: the Web Worker that holds one snapshot's
 * blast-radius data and answers queries, so a large traversal never blocks the
 * main thread. Messages are defined in `./messages`.
 */
import { buildBlastRadiusIndex, computeBlastRadiusFromData, type BlastRadiusIndex } from "./traverse";
import type { WorkerRequest, WorkerResponse } from "./messages";

let index: BlastRadiusIndex | undefined;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "load") {
    index = buildBlastRadiusIndex(request.data);
    scope.postMessage({ type: "loaded" });
    return;
  }
  if (index === undefined) {
    scope.postMessage({ type: "error", requestId: request.requestId, message: "blast-radius data not loaded" });
    return;
  }
  scope.postMessage({
    type: "result",
    requestId: request.requestId,
    result: computeBlastRadiusFromData(index, request.node) ?? null,
  });
};
