/**
 * Tests for symbol-table construction (Task 6).
 *
 * Covers the two correctness properties this module underpins (design
 * "Property 7: Resolution determinism" / property list item 6):
 * - **Collision determinism (R4.5).** Given colliding FQNs, the retained node
 *   is always the canonical-first one (min id under byte-wise UTF-8 order),
 *   regardless of insertion order.
 * - **Build-order independence (R4.6).** Building from the same node set in any
 *   order yields identical name → node mappings.
 *
 * Plus unit tests for the class/function keying rules (R4.2–R4.4) and the
 * not-found contract (R4.7).
 *
 * Uses `fast-check` over `node:test`, per the design's testing strategy.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import type { GraphNode } from "@repohive/shared";
import { compareUtf8 } from "./canonical.js";
import {
  buildSymbolTable,
  createSymbolTableBuilder,
} from "./symbol-table.js";

// --- Generators -----------------------------------------------------------

/** A small pool of enclosing-class FQNs so collisions are likely. */
const fqnArb = fc.constantFrom(
  "com.example.A",
  "com.example.B",
  "com.example.pkg.C",
  "Root", // default-package class
);

/** A small pool of simple names so function/class keys collide. */
const nameArb = fc.constantFrom("m", "run", "A", "value");

/** A parameter-type list token (drives function-overload collisions). */
const paramsArb = fc.constantFrom("", "int", "com.example.User", "int,long");

/** A class node whose id encodes its FQN (`class:` + FQN). */
const classNodeArb: fc.Arbitrary<GraphNode> = fqnArb.map((fqn) => ({
  id: `class:${fqn}`,
  kind: "class",
  directoryPath: "src",
}));

/**
 * A function node whose id encodes `func:` + enclosingFqn + `#name(params)`.
 * Overloads (same enclosing FQN + name, different params) collide on key
 * `enclosingFqn.name`, exercising R4.5.
 */
const functionNodeArb: fc.Arbitrary<GraphNode> = fc
  .tuple(fqnArb, nameArb, paramsArb)
  .map(([enclosing, name, params]) => ({
    id: `func:${enclosing}#${name}(${params})`,
    kind: "function",
    directoryPath: "src",
    definedInFile: `file:src/${name}.java`,
  }));

/** A `file` node — never keyed by the symbol table. */
const fileNodeArb: fc.Arbitrary<GraphNode> = fc
  .constantFrom("src/A.java", "src/B.java", "src/pkg/C.java")
  .map((rel) => ({
    id: `file:${rel}`,
    kind: "file",
    directoryPath: rel.split("/").slice(0, -1).join("/"),
  }));

const anyNodeArb = fc.oneof(classNodeArb, functionNodeArb, fileNodeArb);

/**
 * A set of nodes with unique ids (two nodes with the same id are the same
 * entity, R3.12). Distinct ids may still share an FQN key (function overloads,
 * or a class vs a same-named function), which is exactly the collision case.
 */
const nodesArb: fc.Arbitrary<GraphNode[]> = fc.uniqueArray(anyNodeArb, {
  minLength: 0,
  maxLength: 20,
  selector: (n) => n.id,
});

// --- Helpers --------------------------------------------------------------

/** Recompute the FQN key for a node the way the module does, for the oracle. */
function keyOf(node: GraphNode): string | null {
  if (node.kind === "class") {
    return node.id.slice("class:".length);
  }
  if (node.kind === "function") {
    const body = node.id.slice("func:".length);
    const hash = body.indexOf("#");
    const enclosing = body.slice(0, hash);
    const after = body.slice(hash + 1);
    const paren = after.indexOf("(");
    const name = paren < 0 ? after : after.slice(0, paren);
    return `${enclosing}.${name}`;
  }
  return null;
}

/**
 * Oracle: the expected winner per key is the node whose id sorts first under
 * byte-wise UTF-8 order (R4.5).
 */
function expectedWinners(nodes: GraphNode[]): Map<string, string> {
  const winners = new Map<string, string>();
  for (const node of nodes) {
    const key = keyOf(node);
    if (key === null) {
      continue;
    }
    const current = winners.get(key);
    if (current === undefined || compareUtf8(node.id, current) < 0) {
      winners.set(key, node.id);
    }
  }
  return winners;
}

/** Deterministic permutation driven by a seed array. */
function permute<T>(items: readonly T[], order: readonly number[]): T[] {
  return items
    .map((item, index) => ({ item, key: order[index] ?? index }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.item);
}

// --- Property: collision determinism (R4.5) -------------------------------

test("colliding FQNs resolve to the canonical-first node in any input order", () => {
  fc.assert(
    fc.property(
      nodesArb,
      fc.array(fc.integer(), { maxLength: 40 }),
      (nodes, order) => {
        const winners = expectedWinners(nodes);
        const table = buildSymbolTable(permute(nodes, order));
        for (const [key, expectedId] of winners) {
          assert.equal(
            table.lookup(key),
            expectedId,
            `key ${key} should resolve to canonical-first ${expectedId}`,
          );
        }
      },
    ),
  );
});

// --- Property: build-order independence (R4.6) ----------------------------

test("symbol table is identical regardless of node build order", () => {
  fc.assert(
    fc.property(
      nodesArb,
      fc.array(fc.integer(), { maxLength: 40 }),
      fc.array(fc.integer(), { maxLength: 40 }),
      (nodes, orderA, orderB) => {
        const tableA = buildSymbolTable(permute(nodes, orderA));
        const tableB = buildSymbolTable(permute(nodes, orderB));
        // Every declared key resolves identically across the two builds.
        for (const key of expectedWinners(nodes).keys()) {
          assert.equal(tableA.lookup(key), tableB.lookup(key));
        }
      },
    ),
  );
});

// --- Unit tests: keying rules and not-found contract ----------------------

test("keys a class by packagePath.simpleName (R4.2)", () => {
  const table = buildSymbolTable([
    { id: "class:com.example.UserService", kind: "class", directoryPath: "src" },
  ]);
  assert.equal(
    table.lookup("com.example.UserService"),
    "class:com.example.UserService",
  );
});

test("keys a default-package class by simple name alone (R4.3)", () => {
  const table = buildSymbolTable([
    { id: "class:Root", kind: "class", directoryPath: "" },
  ]);
  assert.equal(table.lookup("Root"), "class:Root");
});

test("keys a function by enclosingClassFqn.simpleName, ignoring params (R4.4)", () => {
  const table = buildSymbolTable([
    {
      id: "func:com.example.UserService#save(com.example.User)",
      kind: "function",
      directoryPath: "src",
      definedInFile: "file:src/UserService.java",
    },
  ]);
  assert.equal(
    table.lookup("com.example.UserService.save"),
    "func:com.example.UserService#save(com.example.User)",
  );
});

test("overloaded functions collide on key and retain the canonical-first id (R4.5)", () => {
  const overloadA: GraphNode = {
    id: "func:com.example.S#m(int)",
    kind: "function",
    directoryPath: "src",
    definedInFile: "file:src/S.java",
  };
  const overloadB: GraphNode = {
    id: "func:com.example.S#m(long)",
    kind: "function",
    directoryPath: "src",
    definedInFile: "file:src/S.java",
  };
  // "func:...#m(int)" < "func:...#m(long)" byte-wise, so overloadA wins.
  assert.ok(compareUtf8(overloadA.id, overloadB.id) < 0);
  assert.equal(
    buildSymbolTable([overloadB, overloadA]).lookup("com.example.S.m"),
    overloadA.id,
  );
  assert.equal(
    buildSymbolTable([overloadA, overloadB]).lookup("com.example.S.m"),
    overloadA.id,
  );
});

test("file nodes are not keyed", () => {
  const table = buildSymbolTable([
    { id: "file:src/A.java", kind: "file", directoryPath: "src" },
  ]);
  assert.equal(table.lookup("file:src/A.java"), null);
  assert.equal(table.lookup("src/A.java"), null);
});

test("lookup returns null for an absent key without throwing (R4.7)", () => {
  const table = buildSymbolTable([]);
  assert.equal(table.lookup("com.example.Nope"), null);
  assert.equal(table.lookup(""), null);
});

test("createSymbolTableBuilder builds an equivalent table", () => {
  const nodes: GraphNode[] = [
    { id: "class:com.example.A", kind: "class", directoryPath: "src" },
  ];
  const table = createSymbolTableBuilder().build(nodes);
  assert.equal(table.lookup("com.example.A"), "class:com.example.A");
});
