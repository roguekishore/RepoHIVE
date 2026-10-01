/**
 * Directory-backed {@link ArtifactStore} (hosting-2 Requirement 1.2, local
 * implementation). An object is two files: the body at `<root>/<key>` and its
 * headers at `<root>/<key>.headers.json`; the second name is never a valid key
 * suffix of a published object, so listing hides it.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { ArtifactStore, ObjectHeaders, StoredObject } from "./artifact-store.js";
import { compareBytewise } from "./canonical-json.js";

const HEADERS_SUFFIX = ".headers.json";

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export function createLocalArtifactStore(root: string): ArtifactStore {
  const base = resolve(root);
  const pathOf = (key: string): string => {
    if (key === "" || key.includes("\\") || key.split("/").some((part) => part === "" || part === "." || part === "..")) {
      throw new RangeError(`not an object key: ${JSON.stringify(key)}`);
    }
    return join(base, ...key.split("/"));
  };

  async function walk(directory: string, found: string[]): Promise<void> {
    let names: import("node:fs").Dirent[];
    try {
      names = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) {
        return;
      }
      throw error;
    }
    for (const entry of names) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full, found);
      } else if (!entry.name.endsWith(HEADERS_SUFFIX)) {
        found.push(full.slice(base.length + 1).split(sep).join("/"));
      }
    }
  }

  return {
    async put(key: string, body: Uint8Array, headers: ObjectHeaders): Promise<void> {
      const file = pathOf(key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, body);
      await writeFile(file + HEADERS_SUFFIX, JSON.stringify(headers));
    },
    async get(key: string): Promise<StoredObject | undefined> {
      const file = pathOf(key);
      try {
        const [body, headers] = await Promise.all([readFile(file), readFile(file + HEADERS_SUFFIX, "utf8")]);
        return { body, headers: JSON.parse(headers) as ObjectHeaders };
      } catch (error) {
        if (isMissing(error)) {
          return undefined;
        }
        throw error;
      }
    },
    async list(prefix: string): Promise<string[]> {
      const found: string[] = [];
      await walk(base, found);
      return found.filter((key) => key.startsWith(prefix)).sort(compareBytewise);
    },
    async delete(keys: readonly string[]): Promise<void> {
      for (const key of keys) {
        const file = pathOf(key);
        await rm(file, { force: true });
        await rm(file + HEADERS_SUFFIX, { force: true });
      }
    },
  };
}
