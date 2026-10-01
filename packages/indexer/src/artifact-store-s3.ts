/**
 * S3 {@link ArtifactStore} (hosting-2 Requirement 1.2, AWS implementation): one
 * bucket, no versioning and no object tags (Requirement 7.6). Exercised against
 * a mocked client here; for real in `hosting-4-deploy`.
 */
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { ArtifactStore, ObjectHeaders, StoredObject } from "./artifact-store.js";
import { compareBytewise } from "./canonical-json.js";

export interface S3ArtifactStoreOptions {
  readonly client: Pick<S3Client, "send">;
  readonly bucket: string;
}

/** S3 allows 1,000 keys per `DeleteObjects` call. */
const DELETE_BATCH = 1000;

function isNoSuchKey(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

export function createS3ArtifactStore(options: S3ArtifactStoreOptions): ArtifactStore {
  const { client, bucket } = options;
  return {
    async put(key: string, body: Uint8Array, headers: ObjectHeaders): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: headers.contentType,
          ...(headers.contentEncoding === undefined ? {} : { ContentEncoding: headers.contentEncoding }),
          ...(headers.cacheControl === undefined ? {} : { CacheControl: headers.cacheControl }),
        }),
      );
    },

    async get(key: string): Promise<StoredObject | undefined> {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (response.Body === undefined) {
          return undefined;
        }
        const body = await response.Body.transformToByteArray();
        const headers: ObjectHeaders = {
          contentType: response.ContentType ?? "application/octet-stream",
          ...(response.ContentEncoding === "br" ? { contentEncoding: "br" as const } : {}),
          ...(response.CacheControl === undefined ? {} : { cacheControl: response.CacheControl }),
        };
        return { body, headers };
      } catch (error) {
        if (isNoSuchKey(error)) {
          return undefined;
        }
        throw error;
      }
    },

    async list(prefix: string): Promise<string[]> {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ...(token === undefined ? {} : { ContinuationToken: token }),
          }),
        );
        for (const item of page.Contents ?? []) {
          if (item.Key !== undefined) {
            keys.push(item.Key);
          }
        }
        token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
      } while (token !== undefined);
      return keys.sort(compareBytewise);
    },

    async delete(keys: readonly string[]): Promise<void> {
      for (let start = 0; start < keys.length; start += DELETE_BATCH) {
        const batch = keys.slice(start, start + DELETE_BATCH);
        const response = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        if ((response.Errors?.length ?? 0) > 0) {
          const first = response.Errors?.[0];
          throw new Error(`S3 delete failed for ${response.Errors?.length} key(s), first ${first?.Key}: ${first?.Code}`);
        }
      }
    },
  };
}
