/**
 * In-memory {@link ArtifactStore}: tests and the in-process local run.
 */
import type { ArtifactStore, ObjectHeaders, StoredObject } from "./artifact-store.js";
import { compareBytewise } from "./canonical-json.js";

export function createMemoryArtifactStore(): ArtifactStore & { readonly objects: ReadonlyMap<string, StoredObject> } {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    async put(key: string, body: Uint8Array, headers: ObjectHeaders): Promise<void> {
      objects.set(key, { body: Uint8Array.from(body), headers: { ...headers } });
    },
    async get(key: string): Promise<StoredObject | undefined> {
      return objects.get(key);
    },
    async list(prefix: string): Promise<string[]> {
      return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort(compareBytewise);
    },
    async delete(keys: readonly string[]): Promise<void> {
      for (const key of keys) {
        objects.delete(key);
      }
    },
  };
}
