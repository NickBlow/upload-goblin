import type { R2Bucket } from "@cloudflare/workers-types";
import type { BlobStorage, FileContents } from "../config";
import { ok, err, safeAsync } from "../config";

/**
 * Implementation of BlobStorage using Cloudflare R2 for object storage.
 * This provides methods for storing, retrieving, and deleting binary data.
 */
export const R2BlobStorage = <TContext>(bucket: R2Bucket): BlobStorage<TContext> => {
  return {
    putBytes: async (id: string, content: FileContents, metadata?: Record<string, any>) => {
      const customMetadata = metadata || {};

      return await safeAsync(
        // @ts-expect-error - the Cloudflare Blob and ReadableStream types are slightly different
        bucket.put(id, content, {
          customMetadata
        })
      ).then(() => ok(undefined));
    },

    getBytes: async (id: string) => {
      const result = await safeAsync(bucket.get(id));
      if (!result.ok) {
        return result;
      }

      const object = result.value;
      if (object === null) {
        return err({ code: 404, message: `No object found with key: ${id}` });
      }

      const metadata = object.customMetadata || {};

      return ok({
        data: object.body as unknown as ReadableStream,
        metadata
      });
    },

    deleteBytes: async (id: string) => {
      return await safeAsync(bucket.delete(id)).then(() => ok(undefined));
    }
  };
};
