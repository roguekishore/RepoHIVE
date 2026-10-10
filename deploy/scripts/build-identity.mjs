// Prints the three build values that go into every snapshot id (layout: engineVersion, viewsVersion,
// configDigest) as one JSON line. verify-release.sh copies this file into the indexer image (/var/task) and into the
// release tree's indexer directory (indexer/) and runs it in both: the pre-check the server runs from the bundle
// computes a job's snapshot id and the worker in the image refuses one that its own build would not compute, so the
// two must print the same line.
//
// Bare imports resolve from where this file is placed, and `./dist/hosted-options.js` is the indexer's own compiled
// code beside it, so it must be run from inside each tree. Both trees have the same layout: dist/ and node_modules/
// with the compiled packages.
import { engineVersion } from "@repohive/engine";
import { getViewsVersion } from "@repohive/views";

const { hostedConfigDigest } = await import(new URL("./dist/hosted-options.js", import.meta.url).href);

process.stdout.write(
  `${JSON.stringify({ engineVersion, viewsVersion: getViewsVersion(), configDigest: hostedConfigDigest() })}\n`,
);
