// Main exports
export { createUploader } from "./uploader";

// Configuration types
export type {
  UploaderConfig,
  UploadRequest,
  UploadComplete,
  RequestValidationRequest,
  DownloadValidationRequest,
  DownloadValidation,
  BlobStorage,
  FileContents,
  DefaultContext,
  Result,
  Ok,
  Err,
  AsyncResult,
  SyncOrAsyncResult,
  Error
} from './config';

// Storage implementations
export { R2BlobStorage } from "./storage/r2";
export { S3BlobStorage, type S3Config } from "./storage/s3-compatible";

// Utilities
export { ok, err, safeAsync } from "./config";

// Signature validation (core functionality)
export { validateSignature } from "./signature";

// Signature generation example (re-export for convenience)
export { generateUploadSignature } from './examples/typescript-signature-generator';

// Alchemy resource for easy deployment
export { GoblinUploader, type GoblinUploaderResourceConfig } from './alchemy/resource';
