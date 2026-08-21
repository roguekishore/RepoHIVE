/**
 * Internal working types for the parser pipeline.
 *
 * NONE of these types are serialized to `graph.json` — only the shared
 * contract types ({@link @repohive/shared}) describe the on-disk shape. These
 * working types live only in memory and are discarded when `parseProject`
 * returns (design: "Internal working types (never serialized)").
 */

import type { GraphNode, NodeId } from "@repohive/shared";

/**
 * A Java source file discovered by the `SourceFileCollector` (R2).
 */
export interface CollectedFile {
  /** Absolute path on disk. */
  absolutePath: string;
  /**
   * POSIX-normalized path relative to the project root (forward slashes, no
   * leading separator). Used for canonical ordering and `directoryPath`
   * derivation, and is the only path material that enters a node id.
   */
  relativePath: string;
}

/**
 * The kind of a raw, unresolved cross-file reference collected during
 * extraction. Phase 1 primarily populates `import`; `type-use` and
 * `method-call` feed the deferred frequency signals.
 */
export type RawReferenceKind = "import" | "type-use" | "method-call";

/**
 * An unresolved reference emitted by the `AstExtractor` for the `Stitcher` to
 * resolve against the symbol table (design: `RawReference`).
 */
export interface RawReference {
  /** The referencing entity (a `file`- or `class`-scoped node id). */
  fromNodeId: NodeId;
  /** The imported / used name as written (may be a FQN or a simple name). */
  targetName: string;
  /** What kind of reference this is. */
  kind: RawReferenceKind;
}

/**
 * The result of extracting a single Java source file (design:
 * `ExtractionResult`). The transient Tree-Sitter AST is discarded once this
 * plain-data result is produced (R3.13).
 */
export interface ExtractionResult {
  /** One `file` node plus the file's `class` / `function` nodes. */
  nodes: GraphNode[];
  /** Unresolved references for the `Stitcher`. */
  references: RawReference[];
  /** The file's declared dotted package, or `""` for the default package. */
  packagePath: string;
}

/**
 * A record of a cross-source-root resolution ambiguity (Fix 24 — Gap 2).
 *
 * Emitted when a reference's FQN is not found in the referring file's own
 * source root but exists in **more than one** other source root, so no
 * classpath-local answer exists. The stitcher picks the byte-first candidate
 * deterministically and records the ambiguity here so the choice is auditable
 * (consistent with the project's honest-caveats posture). This never enters the
 * JSON contract; it is surfaced on {@link ParseSuccess} and the CLI only.
 */
export interface CrossScopeAmbiguity {
  /** The `file` node id whose reference was ambiguous. */
  referringFile: NodeId;
  /** The fully qualified name that resolved to multiple source roots. */
  targetFqn: string;
  /** The deterministically chosen (byte-first) target node id. */
  chosenId: NodeId;
  /** All candidate node ids, in canonical order (chosenId is the first). */
  candidateIds: NodeId[];
}
