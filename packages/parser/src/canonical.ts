/**
 * Canonical ordering and stable serialization for the dependency graph (R9).
 *
 * Determinism is a hard requirement of the parser: identical input MUST yield a
 * byte-identical `graph.json` (identical SHA-256). Two primitives make that
 * possible and both live here:
 *
 * 1. **Canonical ordering** — a total order over nodes (by node id) and edges
 *    (by the `(source, target)` id pair), compared *byte-wise* over the UTF-8
 *    encoding of the identifier strings (R9.2, R9.3). Byte-wise (rather than
 *    JavaScript's default UTF-16 code-unit) comparison guarantees the order is
 *    independent of the JS engine and matches the on-disk byte order.
 * 2. **Stable stringification** — a hand-written JSON stringifier that emits a
 *    fixed key order within every object, arrays in canonical order, `\n` line
 *    endings, and no byte-order mark, so the byte-level output is fully
 *    determined by graph content (R9.6). It deliberately does NOT use
 *    `JSON.stringify` with default key ordering.
 *
 * This module is pure and side-effect free: it neither reads nor writes the
 * filesystem. The {@link GraphSerializer} (Task 8) is responsible for writing
 * the returned string to disk as UTF-8 without a BOM.
 */

import type {
  DependencyEdge,
  GraphNode,
  RawDependencyGraph,
} from "@repohive/shared";

/**
 * Compare two identifier strings byte-wise over their UTF-8 encoding.
 *
 * Returns a negative number if `a` sorts before `b`, a positive number if it
 * sorts after, and `0` when the two strings are byte-for-byte equal. This is
 * the total order required by R9.2 / R9.3; `Buffer.compare` performs the
 * unsigned byte-wise lexicographic comparison of the UTF-8 bytes.
 */
export function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Canonical comparator for {@link GraphNode}s: ascending by `id`, compared
 * byte-wise over the UTF-8 id string (R9.2).
 */
export function compareNodes(a: GraphNode, b: GraphNode): number {
  return compareUtf8(a.id, b.id);
}

/**
 * Canonical comparator for {@link DependencyEdge}s: ascending by the
 * `(source, target)` pair — `source` primary, `target` tie-break — each
 * compared byte-wise over its UTF-8 string (R9.3). Because every `(source,
 * target)` pair is unique in a well-formed graph, this order is total.
 */
export function compareEdges(a: DependencyEdge, b: DependencyEdge): number {
  const bySource = compareUtf8(a.source, b.source);
  return bySource !== 0 ? bySource : compareUtf8(a.target, b.target);
}

/**
 * Return a new graph whose `nodes` and `edges` arrays are in canonical order.
 *
 * The input graph is not mutated; the arrays are copied before sorting so the
 * function stays pure. Sorting here (rather than relying on the caller) means
 * {@link stringifyGraph} always emits canonical output regardless of the order
 * in which the pipeline produced nodes and edges.
 */
export function sortGraphCanonically(
  graph: RawDependencyGraph,
): RawDependencyGraph {
  return {
    nodes: [...graph.nodes].sort(compareNodes),
    edges: [...graph.edges].sort(compareEdges),
  };
}

/** JSON-escape a primitive string value. */
function quote(value: string): string {
  return JSON.stringify(value);
}

/**
 * Serialize a single graph node with the canonical key order:
 * `id`, `kind`, `packagePath?`, `directoryPath`, `definedInFile?`.
 *
 * Optional keys (`packagePath`, `definedInFile`) are emitted only when they are
 * not `undefined`; this is a pure formatting concern. The policy of *when* an
 * optional field should be absent (for example, omitting an empty
 * `packagePath`) belongs to the {@link GraphSerializer} (R7.2, R7.3), which
 * passes `undefined` for fields it wants omitted.
 *
 * @param indent - the leading whitespace for the object's own line
 * @param inner - the leading whitespace for the object's member lines
 */
function stringifyNode(node: GraphNode, indent: string, inner: string): string {
  const lines: string[] = [];
  lines.push(`${inner}${quote("id")}: ${quote(node.id)}`);
  lines.push(`${inner}${quote("kind")}: ${quote(node.kind)}`);
  if (node.packagePath !== undefined) {
    lines.push(`${inner}${quote("packagePath")}: ${quote(node.packagePath)}`);
  }
  lines.push(
    `${inner}${quote("directoryPath")}: ${quote(node.directoryPath)}`,
  );
  if (node.definedInFile !== undefined) {
    lines.push(
      `${inner}${quote("definedInFile")}: ${quote(node.definedInFile)}`,
    );
  }
  return `${indent}{\n${lines.join(",\n")}\n${indent}}`;
}

/** Format a frequency signal as a JSON number token. */
function num(value: number): string {
  // The three frequency signals are contract-guaranteed finite, non-negative
  // integers by the time serialization runs (R6.5). `String` yields the plain
  // decimal token with no exponent for such values.
  return String(value);
}

/**
 * Serialize a single dependency edge with the canonical key order:
 * `source`, `target`, `importFrequency`, `methodCallFrequency`,
 * `sharedTypeCount`. The optional `strength` field is never emitted (R7.7).
 */
function stringifyEdge(
  edge: DependencyEdge,
  indent: string,
  inner: string,
): string {
  const lines = [
    `${inner}${quote("source")}: ${quote(edge.source)}`,
    `${inner}${quote("target")}: ${quote(edge.target)}`,
    `${inner}${quote("importFrequency")}: ${num(edge.importFrequency)}`,
    `${inner}${quote("methodCallFrequency")}: ${num(edge.methodCallFrequency)}`,
    `${inner}${quote("sharedTypeCount")}: ${num(edge.sharedTypeCount)}`,
  ];
  return `${indent}{\n${lines.join(",\n")}\n${indent}}`;
}

/** Serialize an array of already-formatted element strings. */
function stringifyArray(elements: string[], indent: string): string {
  if (elements.length === 0) {
    return "[]";
  }
  return `[\n${elements.join(",\n")}\n${indent}]`;
}

/**
 * Stably stringify a dependency graph to its canonical `graph.json` text.
 *
 * The graph is first sorted into canonical order (nodes by id, edges by
 * `(source, target)`), then emitted with a fixed key order in every object,
 * top-level `nodes` before `edges`, two-space indentation, `\n` line endings,
 * and a trailing newline. The returned string contains no byte-order mark; the
 * caller writes it as UTF-8. For two graphs with equal content this function
 * returns byte-identical text (R9.6).
 */
export function stringifyGraph(graph: RawDependencyGraph): string {
  const sorted = sortGraphCanonically(graph);

  const nodeIndent = "    ";
  const nodeInner = "      ";
  const nodeStrings = sorted.nodes.map((node) =>
    stringifyNode(node, nodeIndent, nodeInner),
  );
  const edgeStrings = sorted.edges.map((edge) =>
    stringifyEdge(edge, nodeIndent, nodeInner),
  );

  const nodesBlock = stringifyArray(nodeStrings, "  ");
  const edgesBlock = stringifyArray(edgeStrings, "  ");

  return (
    "{\n" +
    `  ${quote("nodes")}: ${nodesBlock},\n` +
    `  ${quote("edges")}: ${edgesBlock}\n` +
    "}\n"
  );
}
