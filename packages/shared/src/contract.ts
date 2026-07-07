/**
 * RepoHIVE shared JSON contract — the universal seam of the engine.
 *
 * These interfaces define the exact on-disk shape of `graph.json`. The parser
 * (`packages/parser`) writes this shape and every downstream consumer (the
 * grouping algorithm, viewer, etc.) reads it, so the contract MUST NOT be
 * modified without a cross-spec decision.
 *
 * This file is copied to match the core `hierarchical-repository-grouping`
 * spec's Data Models exactly so both specs agree on the seam.
 *
 * Parser-specific notes:
 * - The parser emits only the `file` / `class` / `function` subset of
 *   {@link NodeKind}. The `group` / `repository` kinds are produced downstream.
 * - The parser NEVER emits the optional `strength` field on an edge; it is left
 *   absent for the downstream Dependency_Weight_Calculator to populate.
 */

/** Stable, content-derived identifier of a graph node. */
export type NodeId = string;

/**
 * The category of a {@link GraphNode}.
 *
 * The parser emits only `file`, `function`, and `class`. `group` and
 * `repository` are reserved for the downstream grouping algorithm.
 */
export type NodeKind = "file" | "function" | "class" | "group" | "repository";

/**
 * A vertex of the dependency graph representing a code entity.
 *
 * Field-omission semantics (not empty-string / null) express "no value":
 * - `packagePath` is omitted when the entity has no declared Java package.
 * - `definedInFile` is present for `class` / `function` nodes and omitted for
 *   `file` nodes.
 */
export interface GraphNode {
  /** Unique, non-empty, content-derived identifier. */
  id: NodeId;
  /** One of the {@link NodeKind} values. */
  kind: NodeKind;
  /** Declared dotted Java package; omitted when there is no declared package. */
  packagePath?: string;
  /**
   * Path of the defining file's directory relative to the project root,
   * forward-slash separated, no leading separator, `""` when at the root.
   */
  directoryPath: string;
  /**
   * Identifier of the `file` node in which a `class` / `function` is declared;
   * omitted on `file` nodes.
   */
  definedInFile?: NodeId;
}

/**
 * A directed edge of the dependency graph from `source` to `target`.
 *
 * Every edge carries exactly the three frequency signals. The `strength` field
 * is optional in the contract but is NEVER emitted by the parser.
 */
export interface DependencyEdge {
  /** Identifier of the source node (an existing node in the graph). */
  source: NodeId;
  /** Identifier of the target node (an existing node in the graph). */
  target: NodeId;
  /** Count of resolved import-based references. Non-negative integer. */
  importFrequency: number;
  /** Count of resolved cross-entity method calls. Non-negative integer. */
  methodCallFrequency: number;
  /** Count of shared type references. Non-negative integer. */
  sharedTypeCount: number;
  /** Downstream-only weight; NEVER emitted by the parser. */
  strength?: number;
}

/**
 * The complete dependency graph. `graph.json` is exactly a serialized
 * `RawDependencyGraph`.
 */
export interface RawDependencyGraph {
  nodes: GraphNode[];
  edges: DependencyEdge[];
}
