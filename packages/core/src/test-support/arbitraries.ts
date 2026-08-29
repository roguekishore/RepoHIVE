/**
 * fast-check arbitraries for the grouping algorithm's property tests
 * (design Testing Strategy).
 *
 * `arbitraryDependencyGraph` produces VALID graphs (unique node ids, no
 * dangling endpoints) with controllable size and:
 * - package/directory structure, including the default package ("" →
 *   directory-fallback Regions) and root-directory files;
 * - file/class/function node mixes with definedInFile set;
 * - arbitrary edge subsets over file/class pairs — diamonds and cycles arise
 *   naturally, at most one edge per ordered (source, target) pair (Gap 15);
 * - varied (import, call, sharedType) signal triples including all-zero;
 * - singleton and edgeless Regions (degenerate cases).
 *
 * Invalid-input arbitraries inject dangling edges and duplicate ids.
 * `shuffleGraph` is the deterministic permutation combinator behind the
 * order-independence properties.
 */

import fc from "fast-check";
import type { DependencyEdge, GraphNode, RawDependencyGraph } from "@repohive/shared";
import { seededRng } from "../community.js";

/** Package pool: "" = default package (directory-fallback Region). */
const PACKAGE_POOL = ["", "com.alpha", "com.alpha.core", "com.beta", "util"] as const;

function directoryOf(packagePath: string, fileIndex: number): string {
  if (packagePath === "") {
    // Some default-package files at the root, some nested.
    return fileIndex % 2 === 0 ? "" : "scratch";
  }
  return `src/${packagePath.split(".").join("/")}`;
}

export interface GraphShape {
  /** Per-file: index into PACKAGE_POOL. */
  filePackages: number[];
  /** Per-file: number of classes (0..2). */
  classCounts: number[];
  /** Per-file: number of functions (0..2). */
  functionCounts: number[];
  /** Chosen edge endpoint pairs as indices into the eligible-node list. */
  edgePicks: Array<{ from: number; to: number }>;
  /** Per-edge signal triple. */
  signals: Array<{ importFrequency: number; methodCallFrequency: number; sharedTypeCount: number }>;
}

export interface ArbitraryGraphOptions {
  minFiles?: number;
  maxFiles?: number;
  maxEdges?: number;
}

/** Build the concrete graph from a generated shape (deterministic). */
export function graphFromShape(shape: GraphShape): RawDependencyGraph {
  const nodes: GraphNode[] = [];
  const edgeEligible: string[] = [];

  shape.filePackages.forEach((packageIndex, i) => {
    const packagePath = PACKAGE_POOL[packageIndex % PACKAGE_POOL.length]!;
    const directoryPath = directoryOf(packagePath, i);
    const fileId = `file:${directoryPath === "" ? "" : `${directoryPath}/`}F${i}.java`;
    nodes.push({
      id: fileId,
      kind: "file",
      ...(packagePath === "" ? {} : { packagePath }),
      directoryPath,
    });
    edgeEligible.push(fileId);

    const classCount = shape.classCounts[i] ?? 0;
    for (let j = 0; j < classCount; j++) {
      const classId = `class:${packagePath === "" ? "" : `${packagePath}.`}F${i}C${j}`;
      nodes.push({
        id: classId,
        kind: "class",
        ...(packagePath === "" ? {} : { packagePath }),
        directoryPath,
        definedInFile: fileId,
      });
      edgeEligible.push(classId);
    }
    const functionCount = shape.functionCounts[i] ?? 0;
    for (let j = 0; j < functionCount; j++) {
      const functionId = `func:${packagePath === "" ? "" : `${packagePath}.`}F${i}C0#m${j}()`;
      nodes.push({
        id: functionId,
        kind: "function",
        ...(packagePath === "" ? {} : { packagePath }),
        directoryPath,
        definedInFile: fileId,
      });
      edgeEligible.push(functionId);
    }
  });

  // Self-edges and function-endpoint edges are kept — the ingestor accepts
  // them, so the properties must quantify over them. Parallel (source, target)
  // duplicates are NOT: the contract admits at most one edge per ordered pair
  // and ingest rejects a graph that breaks it (Gap 15), so generating them
  // would only ever exercise the rejection path. The first pick for each pair
  // wins, which keeps the mapping from shape to graph a pure function.
  const seenPairs = new Set<string>();
  const edges: DependencyEdge[] = [];
  shape.edgePicks.forEach((pick, i) => {
    const source = edgeEligible[pick.from % edgeEligible.length]!;
    const target = edgeEligible[pick.to % edgeEligible.length]!;
    const key = `${source} ${target}`;
    if (seenPairs.has(key)) {
      return;
    }
    seenPairs.add(key);
    const signal = shape.signals[i] ?? { importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0 };
    edges.push({ source, target, ...signal });
  });

  return { nodes, edges };
}

export function arbitraryDependencyGraph(
  options: ArbitraryGraphOptions = {}
): fc.Arbitrary<RawDependencyGraph> {
  const minFiles = options.minFiles ?? 1;
  const maxFiles = options.maxFiles ?? 10;
  const maxEdges = options.maxEdges ?? 24;
  return fc
    .record({
      filePackages: fc.array(fc.nat(PACKAGE_POOL.length - 1), { minLength: minFiles, maxLength: maxFiles }),
      classSeed: fc.array(fc.nat(2), { maxLength: maxFiles }),
      functionSeed: fc.array(fc.nat(2), { maxLength: maxFiles }),
      edgePicks: fc.array(fc.record({ from: fc.nat(200), to: fc.nat(200) }), { maxLength: maxEdges }),
      signals: fc.array(
        fc.record({
          importFrequency: fc.nat(5),
          methodCallFrequency: fc.nat(5),
          sharedTypeCount: fc.nat(5),
        }),
        { maxLength: maxEdges }
      ),
    })
    .map(({ filePackages, classSeed, functionSeed, edgePicks, signals }) =>
      graphFromShape({
        filePackages,
        classCounts: filePackages.map((_, i) => classSeed[i] ?? 0),
        functionCounts: filePackages.map((_, i) => functionSeed[i] ?? 0),
        edgePicks,
        signals,
      })
    );
}

/**
 * Deterministic Fisher–Yates permutation of the graph's node and edge arrays
 * (content unchanged) — the order-independence combinator (Req 7.2).
 */
export function shuffleGraph(graph: RawDependencyGraph, seed: number): RawDependencyGraph {
  return {
    nodes: shuffled(graph.nodes, seed),
    edges: shuffled(graph.edges, seed + 1),
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rng = seededRng(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** A valid graph plus one edge whose endpoint id exists in no node (Req 1.2). */
export function arbitraryGraphWithDanglingEdge(): fc.Arbitrary<{
  graph: RawDependencyGraph;
  missingId: string;
}> {
  return fc
    .tuple(arbitraryDependencyGraph(), fc.nat(1000), fc.boolean())
    .map(([graph, suffix, missingAtSource]) => {
      const missingId = `ghost:${suffix}`;
      const anchor = graph.nodes[0]!.id;
      const edge: DependencyEdge = missingAtSource
        ? { source: missingId, target: anchor, importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0 }
        : { source: anchor, target: missingId, importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0 };
      return { graph: { nodes: graph.nodes, edges: [...graph.edges, edge] }, missingId };
    });
}

/** A graph in which one node id appears twice (Req 1.5). */
export function arbitraryGraphWithDuplicateNode(): fc.Arbitrary<{
  graph: RawDependencyGraph;
  duplicatedId: string;
}> {
  return fc.tuple(arbitraryDependencyGraph(), fc.nat(50)).map(([graph, pick]) => {
    const victim = graph.nodes[pick % graph.nodes.length]!;
    return {
      graph: { nodes: [...graph.nodes, { ...victim }], edges: graph.edges },
      duplicatedId: victim.id,
    };
  });
}
