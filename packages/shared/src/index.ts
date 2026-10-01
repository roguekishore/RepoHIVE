export type {
  NodeId,
  NodeKind,
  GraphNode,
  DependencyEdge,
  RawDependencyGraph,
} from "./contract.js";

export { compareCanonical } from "./canonical-order.js";
export { CHUNK_MAX_LENGTH, CHUNK_TARGET_LENGTH, coalesceChunks } from "./chunks.js";
