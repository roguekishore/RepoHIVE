import type { BlastRadiusData } from "@repohive/views";
import type { BlastRadiusResult } from "./traverse";

export type WorkerRequest =
  | { type: "load"; data: BlastRadiusData }
  | { type: "query"; requestId: number; node: string };

export type WorkerResponse =
  | { type: "loaded" }
  | { type: "result"; requestId: number; result: BlastRadiusResult | null }
  | { type: "error"; requestId: number; message: string };
