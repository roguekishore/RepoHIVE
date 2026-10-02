// Prints the three build values that go into every snapshot id (layout: engineVersion, viewsVersion,
// configDigest) as one JSON line. verify-release.sh copies this file into the indexer image (/var/task) and into the
// release tree (app/packages/web) and runs it in both: the web app computes a job's snapshot id and the job refuses
// one that its own build would not compute, so the two must print the same line.
//
// Bare imports resolve from where this file is placed, so it must be run from inside each tree.
import { engineVersion } from "@repohive/engine";
import { getViewsVersion } from "@repohive/views";

async function hostedConfigDigest() {
  try {
    // The release tree carries the indexer as a package.
    return (await import("@repohive/indexer")).hostedConfigDigest();
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    // The indexer image is the indexer itself: its dist/ sits beside this file.
    return (await import(new URL("./dist/hosted-options.js", import.meta.url).href)).hostedConfigDigest();
  }
}

process.stdout.write(
  `${JSON.stringify({ engineVersion, viewsVersion: getViewsVersion(), configDigest: await hostedConfigDigest() })}\n`,
);
