/**
 * Snapshot identity and object layout.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  VIEW_FILES,
  architectureLevelKey,
  buildLatest,
  buildManifest,
  historyKey,
  indexObjectKey,
  indexPrefix,
  isValidRepoName,
  jsonBytes,
  latestKey,
  manifestKey,
  recordPublish,
  regionDetailKey,
  repoKey,
  snapshotIdOf,
  snapshotPrefix,
  viewKey,
  type SnapshotInputs,
} from "./layout.js";

const INPUTS: SnapshotInputs = {
  repo: "github.com/acme/widgets",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  engineVersion: "aaaaaaaaaaaaaaaa",
  viewsVersion: "bbbbbbbbbbbbbbbb",
  configDigest: "c".repeat(64),
};

const ID = "0123456789abcdef0123456789abcdef";

// --- snapshot id ---------------------------------------------------------------------

test("the snapshot id is the first 32 hex characters of SHA-256 over the canonical inputs", () => {
  const canonical =
    '{"commitSha":"0123456789abcdef0123456789abcdef01234567","configDigest":"' +
    "c".repeat(64) +
    '","engineVersion":"aaaaaaaaaaaaaaaa","repo":"github.com/acme/widgets","viewsVersion":"bbbbbbbbbbbbbbbb"}';
  const expected = createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32);
  assert.equal(snapshotIdOf(INPUTS), expected);
  assert.match(snapshotIdOf(INPUTS), /^[0-9a-f]{32}$/);
});

test("the snapshot id ignores property order and extra properties", () => {
  const reordered = {
    configDigest: INPUTS.configDigest,
    viewsVersion: INPUTS.viewsVersion,
    engineVersion: INPUTS.engineVersion,
    commitSha: INPUTS.commitSha,
    repo: INPUTS.repo,
    extra: "ignored",
  };
  assert.equal(snapshotIdOf(reordered), snapshotIdOf(INPUTS));
});

test("each input moves the snapshot id", () => {
  const base = snapshotIdOf(INPUTS);
  for (const field of ["repo", "commitSha", "engineVersion", "viewsVersion", "configDigest"] as const) {
    const changed = { ...INPUTS, [field]: field === "repo" ? "github.com/acme/gadgets" : `${INPUTS[field]}0` };
    assert.notEqual(snapshotIdOf(changed), base, field);
  }
});

test("the snapshot id requires the canonical lowercase repo", () => {
  assert.throws(() => snapshotIdOf({ ...INPUTS, repo: "github.com/Acme/widgets" }), RangeError);
  assert.throws(() => snapshotIdOf({ ...INPUTS, repo: "acme/widgets" }), RangeError);
  assert.throws(() => snapshotIdOf({ ...INPUTS, repo: "github.com/acme/.." }), RangeError);
});

test("repoKey lowercases a valid name and rejects an invalid one", () => {
  assert.equal(repoKey("Acme-Co", "My.Repo_1"), "github.com/acme-co/my.repo_1");
  assert.ok(isValidRepoName("a", "b"));
  for (const [owner, repo] of [
    ["", "b"],
    ["a".repeat(40), "b"],
    ["a_b", "c"],
    ["a", ""],
    ["a", "r".repeat(101)],
    ["a", "."],
    ["a", ".."],
    ["a", "x/y"],
    ["a", "x y"],
  ] as const) {
    assert.equal(isValidRepoName(owner, repo), false, `${owner}/${repo}`);
    assert.throws(() => repoKey(owner, repo), RangeError);
  }
});

// --- keys ------------------------------------------------------------------------------

test("public keys equal their URL paths", () => {
  assert.equal(snapshotPrefix(ID), `s/${ID}/`);
  assert.equal(manifestKey(ID), `s/${ID}/manifest.json`);
  assert.equal(latestKey("github.com/acme/widgets"), "r/github.com/acme/widgets/latest.json");
});

test("view keys follow the fixed file names", () => {
  assert.deepEqual(
    Object.values(VIEW_FILES).map((file) => viewKey(ID, file)),
    [
      "repo",
      "graph",
      "adaptivity",
      "hierarchy-scale",
      "region-decisions",
      "zoom-map",
      "architecture",
      "region-detail-index",
      "blast-radius",
    ].map((name) => `s/${ID}/views/${name}.json`),
  );
  assert.equal(architectureLevelKey(ID, 0), `s/${ID}/views/architecture/0.json`);
  assert.equal(regionDetailKey(ID, 12), `s/${ID}/views/region-detail/12.json`);
  assert.throws(() => architectureLevelKey(ID, -1), RangeError);
  assert.throws(() => regionDetailKey(ID, 1.5), RangeError);
});

test("non-public keys sit under idx/ and meta/", () => {
  assert.equal(indexPrefix(ID), `idx/${ID}/`);
  assert.equal(indexObjectKey(ID, "hierarchy.json"), `idx/${ID}/hierarchy.json`);
  assert.equal(historyKey("github.com/acme/widgets"), "meta/github.com/acme/widgets/history.json");
  for (const bad of ["", ".", "..", "a/b", "a\\b"]) {
    assert.throws(() => indexObjectKey(ID, bad), RangeError, bad);
  }
});

test("key builders reject a malformed snapshot id or repo", () => {
  for (const bad of ["", ID.toUpperCase(), `${ID}0`, "../x"]) {
    assert.throws(() => snapshotPrefix(bad), RangeError, bad);
    assert.throws(() => indexPrefix(bad), RangeError, bad);
  }
  assert.throws(() => latestKey("github.com/acme/../x"), RangeError);
  assert.throws(() => historyKey("GitHub.com/acme/widgets"), RangeError);
});

// --- documents ---------------------------------------------------------------------------

test("jsonBytes is unindented UTF-8 with no trailing newline", () => {
  assert.equal(jsonBytes({ a: [1, "\u00e9"] }).toString("utf8"), '{"a":[1,"\u00e9"]}');
});

const MANIFEST_FIELDS = {
  repo: INPUTS.repo,
  commitSha: INPUTS.commitSha,
  engineVersion: INPUTS.engineVersion,
  viewsVersion: INPUTS.viewsVersion,
  indexFormatVersion: 1,
};

test("the manifest lists every file sorted by key, with uncompressed size and SHA-256", () => {
  const objects = [
    { key: `s/${ID}/views/repo.json`, content: Buffer.from('{"r":1}') },
    { key: `idx/${ID}/nodes.json`, content: Buffer.from("[]") },
    { key: `s/${ID}/views/architecture/10.json`, content: Buffer.from("{}") },
    { key: `s/${ID}/views/architecture/2.json`, content: Buffer.from("{ }") },
  ];
  const manifest = buildManifest(MANIFEST_FIELDS, objects);
  assert.deepEqual(Object.keys(manifest), [
    "manifestVersion",
    "repo",
    "commitSha",
    "engineVersion",
    "viewsVersion",
    "indexFormatVersion",
    "files",
  ]);
  assert.equal(manifest.manifestVersion, 1);
  assert.deepEqual(
    manifest.files.map((file) => file.key),
    [
      `idx/${ID}/nodes.json`,
      `s/${ID}/views/architecture/10.json`,
      `s/${ID}/views/architecture/2.json`,
      `s/${ID}/views/repo.json`,
    ],
  );
  const repoFile = manifest.files[3];
  assert.equal(repoFile?.bytes, 7);
  assert.equal(repoFile?.sha256, createHash("sha256").update('{"r":1}').digest("hex"));
});

test("the manifest is a pure function of its inputs and carries no timestamp", () => {
  const objects = [
    { key: `s/${ID}/views/b.json`, content: Buffer.from("b") },
    { key: `s/${ID}/views/a.json`, content: Buffer.from("a") },
  ];
  const first = jsonBytes(buildManifest(MANIFEST_FIELDS, objects));
  const second = jsonBytes(buildManifest(MANIFEST_FIELDS, [...objects].reverse()));
  assert.deepEqual(first, second);
  assert.doesNotMatch(first.toString("utf8"), /At"|time|date/i);
});

test("the manifest rejects duplicate keys", () => {
  const object = { key: `s/${ID}/views/a.json`, content: Buffer.from("a") };
  assert.throws(() => buildManifest(MANIFEST_FIELDS, [object, object]), RangeError);
});

test("latest.json holds the pointer version, identity and an ISO-8601 UTC publish time", () => {
  const latest = buildLatest(
    {
      repo: INPUTS.repo,
      snapshotId: ID,
      commitSha: INPUTS.commitSha,
      engineVersion: INPUTS.engineVersion,
      viewsVersion: INPUTS.viewsVersion,
    },
    new Date(Date.UTC(2026, 9, 1, 12, 30, 0)),
  );
  assert.deepEqual(latest, {
    pointerVersion: 1,
    repo: INPUTS.repo,
    snapshotId: ID,
    commitSha: INPUTS.commitSha,
    engineVersion: INPUTS.engineVersion,
    viewsVersion: INPUTS.viewsVersion,
    publishedAt: "2026-10-01T12:30:00.000Z",
  });
  assert.deepEqual(Object.keys(latest), [
    "pointerVersion",
    "repo",
    "snapshotId",
    "commitSha",
    "engineVersion",
    "viewsVersion",
    "publishedAt",
  ]);
});

test("history puts the new snapshot first and retires the previous current one", () => {
  const a = "a".repeat(32);
  const b = "b".repeat(32);
  const c = "c".repeat(32);
  const t1 = new Date("2026-10-01T00:00:00.000Z");
  const t2 = new Date("2026-10-02T00:00:00.000Z");
  const t3 = new Date("2026-10-03T00:00:00.000Z");
  const first = recordPublish(undefined, a, t1);
  assert.deepEqual(first, { snapshots: [{ snapshotId: a, publishedAt: t1.toISOString(), retiredAt: null }] });
  const third = recordPublish(recordPublish(first, b, t2), c, t3);
  assert.deepEqual(third.snapshots, [
    { snapshotId: c, publishedAt: t3.toISOString(), retiredAt: null },
    { snapshotId: b, publishedAt: t2.toISOString(), retiredAt: t3.toISOString() },
    { snapshotId: a, publishedAt: t1.toISOString(), retiredAt: t2.toISOString() },
  ]);
});

test("publishing a snapshot again moves it to the front instead of repeating it", () => {
  const a = "a".repeat(32);
  const b = "b".repeat(32);
  const t1 = new Date("2026-10-01T00:00:00.000Z");
  const t2 = new Date("2026-10-02T00:00:00.000Z");
  const t3 = new Date("2026-10-03T00:00:00.000Z");
  const history = recordPublish(recordPublish(recordPublish(undefined, a, t1), b, t2), a, t3);
  assert.deepEqual(history.snapshots, [
    { snapshotId: a, publishedAt: t3.toISOString(), retiredAt: null },
    { snapshotId: b, publishedAt: t2.toISOString(), retiredAt: t3.toISOString() },
  ]);
  assert.throws(() => recordPublish(history, "not-an-id", t3), RangeError);
});
