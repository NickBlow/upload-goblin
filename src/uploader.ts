import type { UploaderConfig, FileContents } from "./config";
import { validateSignature } from "./signature";

/**
 * Creates a file uploader with signature validation and post-upload hooks.
 *
 * @param config Configuration for the uploader including storage and validation
 * @returns Object with upload handler function
 */
export function createUploader<
  TContext extends Record<string, any> = Record<string, any>,
>(config: UploaderConfig<TContext>) {
  return {
    /**
     * Handles file upload with PUT method, signature validation, and post-upload hook
     *
     * @param req The incoming request
     * @returns Response indicating success or failure
     */
    handleUpload: async (req: Request): Promise<Response> => {
      try {
        // Generate context
        const context = config.contextFn
          ? await config.contextFn(req)
          : ({} as TContext);

        // Extract file ID from URL path (assumes /upload/:fileId)
        const url = new URL(req.url);
        const pathParts = url.pathname.split("/");
        const fileId = pathParts[pathParts.length - 1];

        if (!fileId) {
          return new Response(
            JSON.stringify({ error: "File ID is required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        // Validate request (can check signatures, auth, rate limits, etc.)
        const requestValidation = await config.validateUploadRequest({
          req,
          fileId,
          context,
        });

        if (!requestValidation.ok) {
          return new Response(
            JSON.stringify({
              error: "Request validation failed",
              details: requestValidation.error.message,
            }),
            {
              status: requestValidation.error.code,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        // Pre-upload hook
        if (config.preUpload) {
          const preUploadResult = await config.preUpload({ req, context });
          if (!preUploadResult.ok) {
            return new Response(
              JSON.stringify({
                error: "Pre-upload validation failed",
                details: preUploadResult.error.message,
              }),
              {
                status: preUploadResult.error.code,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        }

        // Extract file content from request body
        if (!req.body) {
          return new Response(
            JSON.stringify({ error: "Request body is required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        const content: FileContents = req.body;

        // Extract metadata from headers
        const metadata: Record<string, any> = {};
        const contentType = req.headers.get("Content-Type");
        if (contentType) {
          metadata.contentType = contentType;
        }

        const contentLength = req.headers.get("Content-Length");
        if (contentLength) {
          metadata.contentLength = parseInt(contentLength, 10);
        }

        const fileName = url.searchParams.get("fileName");
        if (fileName) {
          metadata.fileName = fileName;
        }

        // Additional metadata from X-Metadata-* headers
        // @ts-ignore TODO: missing entries in type?
        for (const [key, value] of req.headers.entries()) {
          if (key.toLowerCase().startsWith("x-metadata-")) {
            const metaKey = key.substring("x-metadata-".length);
            // Convert kebab-case to PascalCase (e.g., 'user-id' -> 'User-Id')
            const formattedKey = metaKey
              .split("-")
              .map(
                (part: string) =>
                  part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
              )
              .join("-");
            metadata[formattedKey] = value;
          }
        }
        // Store the file
        const uploadResult = await config.storage.putBytes(
          fileId,
          content,
          metadata,
          context,
        );

        if (!uploadResult.ok) {
          return new Response(
            JSON.stringify({
              error: "Failed to store file",
              details: uploadResult.error.message,
            }),
            {
              status: uploadResult.error.code,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        // Post-upload hook
        if (config.postUpload) {
          const postUploadResult = await config.postUpload({
            req,
            fileId,
            metadata,
            context,
          });

          if (!postUploadResult.ok) {
            // Log the error but don't fail the upload since the file is already stored
            console.error("Post-upload hook failed:", postUploadResult.error);
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            fileId,
            message: "File uploaded successfully",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      } catch (error: any) {
        console.error("Upload error:", error);
        return new Response(
          JSON.stringify({
            error: "Internal server error",
            details: error.message || "Unknown error occurred",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    },

    /**
     * Handles file download with optional validation
     *
     * @param req The incoming request
     * @returns Response with file content and metadata headers
     */
    handleDownload: async (req: Request): Promise<Response> => {
      try {
        // Generate context
        const context = config.contextFn
          ? await config.contextFn(req)
          : ({} as TContext);

        // Extract file ID from URL path (assumes /download/:fileId)
        const url = new URL(req.url);
        const pathParts = url.pathname.split("/");
        const fileId = pathParts[pathParts.length - 1];

        if (!fileId) {
          return new Response(
            JSON.stringify({ error: "File ID is required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        // Validate download if validation is provided
        if (config.downloadValidation !== undefined) {
          if (typeof config.downloadValidation === "string") {
            // String = signature validation
            const signature =
              req.headers.get("Authorization")?.replace("Bearer ", "") ||
              url.searchParams.get("signature");

            if (!signature) {
              return new Response(
                JSON.stringify({ error: "Signature required for download" }),
                {
                  status: 401,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }

            const validation = validateSignature(
              signature,
              config.downloadValidation,
              req,
            );
            if (!validation.valid) {
              return new Response(
                JSON.stringify({
                  error: "Download signature validation failed",
                  details: validation.error,
                }),
                {
                  status: 401,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
          } else {
            // Custom validation function
            const validation = await config.downloadValidation({
              req,
              fileId,
              context,
            });
            if (!validation.valid) {
              return new Response(
                JSON.stringify({
                  error: "Download validation failed",
                  details: validation.error || "Access denied",
                }),
                {
                  status: 403,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
          }
        }

        // Get file from storage
        const downloadResult = await config.storage.getBytes(fileId, context);

        if (!downloadResult.ok) {
          return new Response(
            JSON.stringify({
              error: "File not found",
              details: downloadResult.error.message,
            }),
            {
              status: downloadResult.error.code,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        const { data, metadata } = downloadResult.value;

        // Prepare response headers with metadata
        const responseHeaders = new Headers();

        // Set content type from metadata
        if (metadata.contentType) {
          responseHeaders.set("Content-Type", metadata.contentType);
        } else {
          responseHeaders.set("Content-Type", "application/octet-stream");
        }

        // Add filename for download with disposition based on query parameter
        if (metadata.fileName) {
          const disposition =
            url.searchParams.get("disposition") === "inline"
              ? "inline"
              : "attachment";
          responseHeaders.set(
            "Content-Disposition",
            `${disposition}; filename="${metadata.fileName}"`,
          );
        }

        // Add custom metadata as X-Metadata-* headers
        Object.entries(metadata).forEach(([key, value]) => {
          if (key !== "contentType" && key !== "fileName") {
            responseHeaders.set(`X-Metadata-${key}`, String(value));
          }
        });

        // Add CORS headers for browser downloads
        responseHeaders.set("Access-Control-Allow-Origin", "*");
        responseHeaders.set("Access-Control-Expose-Headers", "*");

        return new Response(data, {
          status: 200,
          headers: responseHeaders,
        });
      } catch (error: any) {
        console.error("Download error:", error);
        return new Response(
          JSON.stringify({
            error: "Internal server error",
            details: error.message || "Unknown error occurred",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    },
  };
}
