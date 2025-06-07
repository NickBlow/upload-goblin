import { isSecret, type Secret } from "alchemy";
import { R2Bucket, Worker } from "alchemy/cloudflare";
import { createUploader } from "../uploader";
import { validateSignature } from "../signature";
import { R2BlobStorage } from "../storage/r2";
import { S3BlobStorage } from "../storage/s3-compatible";
import type {
  BlobStorage,
  UploaderConfig,
  RequestValidationRequest as ValidationRequest,
} from "../config";
import { ok, err } from "../config";

export interface GoblinUploaderResourceConfig {
  name: string;

  // Validation: either a secret string or custom validator function
  uploadValidation:
    | Secret
    | ((
        request: ValidationRequest,
      ) =>
        | Promise<{ valid: boolean; error?: string }>
        | { valid: boolean; error?: string });

  // Storage: either R2 bucket config, S3 config, or custom BlobStorage
  storage:
    | {
        type: "r2";
        bucket: R2Bucket;
      }
    | {
        type: "s3";
        credentials: { accessKeyId: Secret; secretAccessKey: Secret };
        endpoint: string;
        region: string;
      }
    | { type: "custom"; storage: BlobStorage };

  // Download validation: string (signature), function (custom), or undefined (public)
  downloadValidation?:
    | Secret
    | ((request: {
        req: Request;
        fileId: string;
        context: any;
      }) =>
        | Promise<{ valid: boolean; error?: string }>
        | { valid: boolean; error?: string })
    | undefined;

  // Optional hooks
  preUpload?: UploaderConfig["preUpload"];
  postUpload?: UploaderConfig["postUpload"];
  contextFn?: UploaderConfig["contextFn"];
}

export async function GoblinUploader(
  name: string,
  config: GoblinUploaderResourceConfig,
) {
  // Set up storage based on config
  let storage: BlobStorage;
  let bucket: any = undefined;

  if (config.storage.type === "r2") {
    // @ts-expect-error - the alchemy resource will shim the correct type at runtime
    storage = R2BlobStorage(config.storage.bucket);
  } else if (config.storage.type === "s3") {
    storage = S3BlobStorage({
      credentials: {
        accessKeyId: config.storage.credentials.accessKeyId.unencrypted,
        secretAccessKey: config.storage.credentials.secretAccessKey.unencrypted,
      },
      endpoint: config.storage.endpoint,
      region: config.storage.region,
    });
  } else {
    storage = config.storage.storage;
  }

  // Set up validation
  const validateUploadRequest = isSecret(config.uploadValidation)
    ? async ({ req }: ValidationRequest) => {
        const signature =
          req.headers.get("Authorization")?.replace("Bearer ", "") ||
          new URL(req.url).searchParams.get("signature");

        if (!signature) {
          return err({ code: 401, message: "Signature required" });
        }

        const validation = validateSignature(
          signature,
          // TODO: Why is the type guard not working?
          (config.uploadValidation as Secret).unencrypted,
          req,
        );
        return validation.valid
          ? ok()
          : err({
              code: validation.error?.includes("Content type")
                ? 415
                : validation.error?.includes("File too large")
                  ? 413
                  : 401,
              message: validation.error || "Invalid signature",
            });
      }
    : async (request: ValidationRequest) => {
        //@ts-ignore TODO: not sure why types are not correct here
        const validation = await config.uploadValidation(request);
        return validation.valid
          ? ok()
          : err({
              code: 401,
              message: validation.error || "Validation failed",
            });
      };

  // Create the uploader
  const uploaderConfig: UploaderConfig = {
    storage,
    //@ts-ignore TODO: not sure why types are not correct here
    validateUploadRequest,
    downloadValidation: isSecret(config.downloadValidation)
      ? config.downloadValidation.unencrypted
      : config.downloadValidation,
    preUpload: config.preUpload,
    postUpload: config.postUpload,
    contextFn: config.contextFn,
  };

  const uploader = createUploader(uploaderConfig);

  // Create the worker
  const worker = Worker(name, import.meta, {
    name: config.name,
    compatibilityDate: "2025-03-10",

    async fetch(request: Request) {
      const url = new URL(request.url);

      // Handle upload requests - PUT /upload/:fileId
      if (request.method === "PUT" && url.pathname.startsWith("/upload/")) {
        return uploader.handleUpload(request);
      }

      // Handle download requests - GET /download/:fileId
      if (request.method === "GET" && url.pathname.startsWith("/download/")) {
        return uploader.handleDownload(request);
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  return {
    worker,
    bucket,
    storage,
    uploader,
  };
}
