/**
 * Reading a repository archive as a stream and refusing anything hostile
 * (hosting-2 Requirement 4). The archive goes through gunzip and a tar reader;
 * nothing is written to disk, entries the selection policy rejects are never
 * buffered, and every limit is enforced while streaming.
 */
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { isSelectedSourcePath, type SourceEntry } from "@repohive/engine";
import tar from "tar-stream";
import type { JobFailure } from "./job-types.js";
import type { FetchCaps, FetchRequest, FetchResult } from "./source-fetcher.js";
import { MAX_JAVA_BYTES, TIER_MAX_FILES, TIER_ORDER, smallestTierForCount } from "./tiers.js";

/** Requirement 4.6 defaults: 1 GiB downloaded, 4 GiB decompressed, 500,000 entries, 5 MiB per selected file. */
export const DEFAULT_FETCH_CAPS: FetchCaps = {
  maxDownloadedBytes: 1024 ** 3,
  maxDecompressedBytes: 4 * 1024 ** 3,
  maxEntries: 500_000,
  maxSelectedFileBytes: 5 * 1024 ** 2,
  timeoutMs: 300_000,
};

const user = (code: string, message: string): JobFailure => ({ failureClass: "user", code, message });
const system = (code: string, message: string): JobFailure => ({ failureClass: "system", code, message });

/** Thrown inside the stream to stop the read with a specific failure. */
class Violation extends Error {
  constructor(readonly failure: JobFailure) {
    super(failure.message);
  }
}

/** Passes bytes through and fails the stream once more than `limit` have passed. */
function limiter(limit: number, onExceed: () => Violation, onBytes: (total: number) => void): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
      total += chunk.length;
      onBytes(total);
      if (total > limit) {
        callback(onExceed());
      } else {
        callback(null, chunk);
      }
    },
  });
}

/** The path inside the archive's top-level directory, or a failure. `isDirectory` entries may be the directory itself. */
function checkName(name: string): JobFailure | undefined {
  if (name.includes("\\")) {
    return user("ARCHIVE_BAD_PATH", "The archive contains a path with a backslash.");
  }
  if (name.startsWith("/")) {
    return user("ARCHIVE_BAD_PATH", "The archive contains an absolute path.");
  }
  for (const segment of name.split("/")) {
    if (segment === ".." || segment === "." || segment === "") {
      return user("ARCHIVE_BAD_PATH", "The archive contains a path with an empty, \".\" or \"..\" segment.");
    }
  }
  return undefined;
}

/**
 * Streams the archive that `open` yields and returns its selected entries.
 * `open` receives the abort signal (caller's signal plus the timeout) and
 * resolves to the compressed bytes; a rejection from it is a `system` failure.
 */
export async function readTarGz(
  open: (signal: AbortSignal) => Promise<Readable>,
  request: FetchRequest,
  caps: FetchCaps,
  signal?: AbortSignal,
): Promise<FetchResult> {
  const timeout = AbortSignal.timeout(caps.timeoutMs);
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

  let violation: Violation | undefined;
  const fail = (failure: JobFailure): Violation => {
    violation ??= new Violation(failure);
    return violation;
  };

  const entries: SourceEntry[] = [];
  const seen = new Set<string>();
  let downloadedBytes = 0;
  let decompressedBytes = 0;
  let entryCount = 0;
  let selectedBytes = 0;
  let topLevel: string | undefined;

  let input: Readable | undefined;
  try {
    input = await open(combined);
    const extract = tar.extract();
    const run = pipeline(
      input,
      limiter(
        caps.maxDownloadedBytes,
        () => fail(user("ARCHIVE_TOO_LARGE", "The repository archive is larger than the download limit.")),
        (total) => (downloadedBytes = total),
      ),
      createGunzip(),
      limiter(
        caps.maxDecompressedBytes,
        () => fail(user("ARCHIVE_TOO_LARGE", "The repository archive is larger than the decompressed size limit.")),
        (total) => (decompressedBytes = total),
      ),
      extract,
      { signal: combined },
    );

    const consume = async (): Promise<void> => {
      for await (const entry of extract) {
        const { header } = entry;
        // One entry's stream must be consumed before the next is delivered.
        const body = entry;
        entryCount += 1;
        if (entryCount > caps.maxEntries) {
          throw fail(user("ARCHIVE_TOO_MANY_ENTRIES", "The repository archive has too many entries."));
        }
        const isDirectory = header.type === "directory";
        const name = isDirectory ? header.name.replace(/\/+$/, "") : header.name;
        const badName = checkName(name);
        if (badName !== undefined) {
          throw fail(badName);
        }
        const slash = name.indexOf("/");
        const first = slash === -1 ? name : name.slice(0, slash);
        if (slash === -1 && !isDirectory) {
          throw fail(user("ARCHIVE_LAYOUT", "The repository archive has an entry outside its top-level directory."));
        }
        topLevel ??= first;
        if (first !== topLevel) {
          throw fail(user("ARCHIVE_LAYOUT", "The repository archive does not have a single top-level directory."));
        }
        if (header.type !== "file" && header.type !== "contiguous-file") {
          // Directories, symlinks, hardlinks and devices: skipped, never followed.
          body.resume();
          continue;
        }
        const relative = name.slice(slash + 1);
        if (!isSelectedSourcePath(relative)) {
          body.resume();
          continue;
        }
        if (seen.has(relative)) {
          throw fail(user("ARCHIVE_DUPLICATE_PATH", "The repository archive lists the same file path twice."));
        }
        if (entries.length >= TIER_MAX_FILES.XL) {
          throw fail(user("TOO_MANY_FILES", "The repository has more Java files than the largest tier allows."));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of body as AsyncIterable<Buffer>) {
          size += chunk.length;
          if (size > caps.maxSelectedFileBytes) {
            throw fail(user("FILE_TOO_LARGE", "A Java file in the repository is larger than the per-file limit."));
          }
          chunks.push(chunk);
        }
        selectedBytes += size;
        if (selectedBytes > MAX_JAVA_BYTES) {
          throw fail(user("REPOSITORY_TOO_LARGE", "The repository has more Java source than the largest tier allows."));
        }
        seen.add(relative);
        entries.push({ path: relative, bytes: Buffer.concat(chunks, size) });
      }
    };

    try {
      await Promise.all([run, consume()]);
    } catch (error) {
      input.destroy();
      extract.destroy();
      throw error;
    }
  } catch (error) {
    input?.destroy();
    if (violation !== undefined) {
      return { ok: false, failure: violation.failure };
    }
    if (error instanceof Violation) {
      return { ok: false, failure: error.failure };
    }
    if (timeout.aborted) {
      return { ok: false, failure: system("FETCH_TIMEOUT", "Fetching the repository took too long.") };
    }
    if (signal?.aborted === true) {
      return { ok: false, failure: system("FETCH_ABORTED", "Fetching the repository was cancelled.") };
    }
    return { ok: false, failure: system("FETCH_FAILED", "The repository archive could not be read.") };
  }

  if (entries.length === 0) {
    return { ok: false, failure: user("NO_JAVA_FILES", "The repository has no Java files to index.") };
  }
  const needed = smallestTierForCount(entries.length);
  if (needed !== undefined && TIER_ORDER.indexOf(needed) > TIER_ORDER.indexOf(request.tier)) {
    return { ok: false, retier: needed };
  }
  return { ok: true, source: { entries, downloadedBytes, decompressedBytes, entryCount } };
}
