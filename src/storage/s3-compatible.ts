import { AwsClient } from "aws4fetch";
import { type FileContents, type BlobStorage, ok, err } from "../config";

export type S3Config = {
  region: string;
  endpoint: string; // Full base URL including bucket path if applicable
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
};

/**
 * Encodes a filename using RFC 2047 encoding for Unicode characters
 * This is required for S3-compatible storage systems that don't support Unicode natively
 */
function encodeRFC2047(str: string): string {
  // Check if the string contains non-ASCII characters
  if (!/[^\x00-\x7F]/.test(str)) {
    return str; // Return as-is if only ASCII
  }
  
  // Encode using RFC 2047: =?UTF-8?B?<base64-encoded-text>?=
  const encoded = btoa(unescape(encodeURIComponent(str)));
  return `=?UTF-8?B?${encoded}?=`;
}

/**
 * Creates an S3-compatible BlobStorage implementation using aws4fetch
 * Works well with Web ReadableStream in browser/edge environments
 *
 * @param config S3 configuration including region, endpoint, and credentials
 * @returns A BlobStorage implementation using S3
 */
export function S3BlobStorage<TContext = Record<string, any>>(
  config: S3Config,
): BlobStorage<TContext> {
  // Create aws4fetch client with provided configuration
  const aws = new AwsClient({
    accessKeyId: config.credentials.accessKeyId,
    secretAccessKey: config.credentials.secretAccessKey,
    region: config.region,
    service: "s3",
  });

  // Use the endpoint directly as the base URL
  const baseUrl = config.endpoint;

  return {
    async putBytes(
      id: string,
      content: FileContents,
      metadata?: Record<string, any>,
    ) {
      // All of these types are natively supported by fetch as BodyInit
      if (
        !(
          content instanceof ReadableStream ||
          content instanceof ArrayBuffer ||
          content instanceof Blob ||
          typeof content === "string"
        )
      ) {
        return err({
          code: 400,
          message: "Unsupported content type",
        });
      }

      const body = content as BodyInit;

      // Extract contentType from metadata if available
      const contentType = metadata?.contentType || "application/octet-stream";

      try {
        // Convert metadata to x-amz-meta-* headers
        // Note: S3 headers must be Latin-1 compatible, so we RFC 2047 encode all metadata
        // that contains Unicode characters to ensure compatibility
        const metadataHeaders: Record<string, string> = {};
        Object.entries(metadata || {}).forEach(([key, value]) => {
          let headerValue = String(value);
          // RFC 2047 encode all metadata if it contains Unicode characters
          headerValue = encodeRFC2047(headerValue);
          metadataHeaders[`x-amz-meta-${key.toLowerCase()}`] = headerValue;
        });

        const response = await aws.fetch(
          `${baseUrl}/${encodeURIComponent(id)}`,
          {
            method: "PUT",
            body,
            headers: {
              "Content-Type": contentType,
              "x-amz-content-sha256": "UNSIGNED-PAYLOAD", // Required for streaming uploads
              ...metadataHeaders,
            },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          return err({
            code: response.status,
            message: errorText || "Failed to upload object to S3",
          });
        }

        return ok();
      } catch (error: any) {
        return err({
          code: 500,
          message: error.message || "Unknown error occurred during upload",
        });
      }
    },

    async getBytes(id: string) {
      try {
        const response = await aws.fetch(
          `${baseUrl}/${encodeURIComponent(id)}`,
          {
            headers: {
              "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
            },
          },
        );

        if (!response.ok) {
          if (response.status === 404) {
            return err({
              code: 404,
              message: "Object not found",
            });
          }

          const errorText = await response.text();
          return err({
            code: response.status,
            message: errorText || "Failed to retrieve object from S3",
          });
        }

        // Extract metadata from response headers
        const metadata: Record<string, any> = {};

        // Process S3 metadata headers (x-amz-meta-*)
        response.headers.forEach((value, key) => {
          if (key.startsWith("x-amz-meta-")) {
            const metaKey = key.substring("x-amz-meta-".length);
            let decodedValue = value;
            
            // Decode RFC 2047 encoded values (especially filenames)
            if (value.startsWith('=?UTF-8?B?') && value.endsWith('?=')) {
              try {
                const base64Part = value.slice(10, -2); // Remove =?UTF-8?B? and ?=
                decodedValue = decodeURIComponent(escape(atob(base64Part)));
              } catch (e) {
                // If decoding fails, use original value
                decodedValue = value;
              }
            }
            
            metadata[metaKey] = decodedValue;
          }
        });

        // Add content type to metadata
        if (response.headers.get("content-type")) {
          metadata.contentType = response.headers.get("content-type");
        }

        // Return stream directly from response
        return ok({
          data: response.body!,
          metadata,
        });
      } catch (error: any) {
        return err({
          code: 500,
          message: error.message || "Unknown error occurred during retrieval",
        });
      }
    },

    async deleteBytes(id: string) {
      try {
        const response = await aws.fetch(
          `${baseUrl}/${encodeURIComponent(id)}`,
          {
            method: "DELETE",
            headers: {
              "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
            },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          return err({
            code: response.status,
            message: errorText || "Failed to delete object from S3",
          });
        }

        return ok();
      } catch (error: any) {
        return err({
          code: 500,
          message: error.message || "Unknown error occurred during deletion",
        });
      }
    },
  };
}
