/**
 * The local {@link SourceFetcher} (hosting-2 Requirement 4.9): a `.tar.gz` file
 * on disk, read through the same stream path as the network fetch.
 */
import { createReadStream } from "node:fs";
import type { FetchCaps, FetchRequest, FetchResult, SourceFetcher } from "./source-fetcher.js";
import { readTarGz } from "./tarball.js";

export function createLocalSourceFetcher(tarballPath: string): SourceFetcher {
  return {
    fetch(request: FetchRequest, caps: FetchCaps, signal?: AbortSignal): Promise<FetchResult> {
      return readTarGz(async () => createReadStream(tarballPath), request, caps, signal);
    },
  };
}
