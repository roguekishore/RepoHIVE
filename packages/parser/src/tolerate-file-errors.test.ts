/**
 * The tolerant parse (`ParseOptions.tolerateFileErrors`): drives the real
 * pipeline over in-memory sources, including the grammar's known misses and a
 * repeated class declaration.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "@repohive/shared";

import { resolveDuplicateDeclarations } from "./duplicate-resolution.js";
import { parseProject } from "./orchestrator.js";

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const good = (name: string, pkg = "p"): { path: string; bytes: Uint8Array } => ({
  path: `${pkg}/${name}.java`,
  bytes: enc(`package ${pkg};\npublic class ${name} { void run() {} }\n`),
});
// A template placeholder: not Java, so tree-sitter reports an ERROR node.
const template = { path: "t/Tpl.java", bytes: enc("package ${package};\nclass Tpl {}\n") };

test("strict mode still fails the whole run on one unparseable file", async () => {
  const result = await parseProject({ source: [good("A"), template], writeGraph: false });
  assert.equal(result.ok, false);
});

test("tolerant mode builds the graph from the files that parsed and reports the rest", async () => {
  const result = await parseProject({
    source: [good("A"), good("B"), template],
    writeGraph: false,
    tolerateFileErrors: true,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.skippedFiles?.map((e) => [e.reason, e.path]),
    [["file-unparseable", "t/Tpl.java"]],
  );
  const ids = result.value.graph?.nodes.map((n) => n.id) ?? [];
  assert.ok(ids.includes("file:p/A.java") && ids.includes("file:p/B.java"));
  assert.ok(!ids.some((id) => id.includes("Tpl")));
});

test("a clean tree has no skippedFiles in either mode, and the same graph", async () => {
  const source = [good("A"), good("B")];
  const strict = await parseProject({ source, writeGraph: false });
  const tolerant = await parseProject({ source, writeGraph: false, tolerateFileErrors: true });
  assert.ok(strict.ok && tolerant.ok);
  if (!strict.ok || !tolerant.ok) return;
  assert.equal(tolerant.value.skippedFiles, undefined);
  assert.deepEqual(tolerant.value.graph, strict.value.graph);
});

test("tolerant mode still fails when no file survives", async () => {
  const result = await parseProject({ source: [template], writeGraph: false, tolerateFileErrors: true });
  assert.equal(result.ok, false);
});

test("two files declaring one class: strict fails, tolerant keeps the first in canonical order", async () => {
  // No package declaration, as in groovy's benchmark/: both files share one source root.
  const a = { path: "b/methcall.java", bytes: enc("class Toggle { void on() {} }\n") };
  const b = { path: "b/objinst.java", bytes: enc("class Toggle { void off() {} }\n") };
  const strict = await parseProject({ source: [a, b], writeGraph: false });
  assert.equal(strict.ok, false);
  for (const order of [[a, b], [b, a]]) {
    const result = await parseProject({ source: order, writeGraph: false, tolerateFileErrors: true });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.deepEqual(
      result.value.skippedFiles?.map((e) => [e.reason, e.path]),
      [["duplicate-node-id", "b/objinst.java"]],
    );
    const ids = result.value.graph?.nodes.map((n) => n.id) ?? [];
    assert.ok(ids.includes("file:b/methcall.java"));
    assert.ok(!ids.includes("file:b/objinst.java"));
    assert.ok(!ids.some((id) => id.startsWith("func:") && id.includes("off")));
  }
});

test("output is identical whatever order the sources arrive in", async () => {
  const a = { path: "b/a.java", bytes: enc("package bench;\nclass T {}\n") };
  const b = { path: "b/z.java", bytes: enc("package bench;\nclass T {}\n") };
  const one = await parseProject({ source: [a, b, template], writeGraph: false, tolerateFileErrors: true });
  const two = await parseProject({ source: [template, b, a], writeGraph: false, tolerateFileErrors: true });
  assert.ok(one.ok && two.ok);
  if (!one.ok || !two.ok) return;
  assert.deepEqual(one.value.graph, two.value.graph);
  assert.deepEqual(one.value.skippedFiles, two.value.skippedFiles);
});

test("resolveDuplicateDeclarations returns the same array when nothing collides", () => {
  const nodes: GraphNode[] = [
    { id: "file:a.java", kind: "file", directoryPath: "" },
    { id: "class:a|A", kind: "class", directoryPath: "", definedInFile: "file:a.java" },
  ];
  const resolved = resolveDuplicateDeclarations(nodes);
  assert.equal(resolved.nodes, nodes);
  assert.deepEqual(resolved.skipped, []);
});

test("a dropped file does not shield a later one from the first", () => {
  const f = (p: string): GraphNode => ({ id: `file:${p}`, kind: "file", directoryPath: "" });
  const c = (p: string): GraphNode => ({ id: "class:T", kind: "class", directoryPath: "", definedInFile: `file:${p}` });
  const resolved = resolveDuplicateDeclarations([f("c.java"), c("c.java"), f("a.java"), c("a.java"), f("b.java"), c("b.java")]);
  assert.deepEqual(resolved.nodes.map((n) => n.id), ["file:a.java", "class:T"]);
  assert.deepEqual(resolved.skipped.map((e) => e.path), ["b.java", "c.java"]);
});
