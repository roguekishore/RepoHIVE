/**
 * The network {@link SourceFetcher}: GitHub's tarball
 * endpoint, streamed. The archive endpoint answers with a redirect to codeload;
 * `fetch` follows it and drops the `Authorization` header across origins.
 */
import { Readable } from "node:stream";
import { githubHeaders, tarballUrl, type FetchFunction } from "./github.js";
import type { FetchCaps, FetchRequest, FetchResult, SourceFetcher } from "./source-fetcher.js";
import { readTarGz } from "./tarball.js";

export interface GithubSourceFetcherOptions {
  /** The server-side token from configuration, never a user's. */
  readonly token: string;
  /** Defaults to the global `fetch`; tests pass a stub. */
  readonly fetch?: FetchFunction;
}

export function createGithubSourceFetcher(options: GithubSourceFetcherOptions): SourceFetcher {
  const doFetch: FetchFunction = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    fetch(request: FetchRequest, caps: FetchCaps, signal?: AbortSignal): Promise<FetchResult> {
      return readTarGz(
        async (abort) => {
          const response = await doFetch(tarballUrl(request.owner, request.repo, request.commitSha), {
            headers: githubHeaders(options.token),
            redirect: "follow",
            signal: abort,
          });
          if (!response.ok || response.body === null) {
            throw new Error(`archive request answered ${response.status}`);
          }
          return Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
        },
        request,
        caps,
        signal,
      );
    },
  };
}
