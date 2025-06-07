// Result pattern
export type Error = { code: number; message: string };

export type Ok<T> = {
  readonly tag: "ok";
  readonly value: T;
  readonly ok: true;
};

export type Err<E> = {
  readonly tag: "err";
  readonly error: E;
  readonly ok: false;
};

export type Result<T, E> = Ok<T> | Err<E>;
export type AsyncResult<T, E> = Promise<Result<T, E>>;
export type SyncOrAsyncResult<T, E> = Result<T, E> | AsyncResult<T, E>;

export async function safeAsync<T>(promise: Promise<T>): AsyncResult<T, Error> {
  try {
    const value = await promise;
    return ok(value) as Ok<T>;
  } catch (error: any) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error
    ) {
      return err(error as Error) as Err<Error>;
    }
    const message =
      error instanceof globalThis.Error ? error.message : String(error);
    return err({
      code: 500,
      message: message || "An unexpected error occurred",
    });
  }
}

export function ok<E = Error>(): Result<void, E>;
export function ok<T, E = Error>(value: T): Result<T, E>;
export function ok<T = void, E = Error>(
  value?: T,
): Result<T extends undefined ? void : T, E> {
  return {
    tag: "ok",
    value: (value === undefined ? undefined : value) as T extends undefined
      ? void
      : T,
    ok: true,
  };
}

export const err = <T, E = Error>(error: E): Result<T, E> => ({
  tag: "err",
  error,
  ok: false,
});

// File types
export type FileContents = ReadableStream | ArrayBuffer | Blob | string;

export type DefaultContext = Record<string, any>;

export type BlobStorage<TContext = DefaultContext> = {
  putBytes: (
    id: string,
    content: FileContents,
    metadata?: Record<string, any>,
    context?: TContext,
  ) => AsyncResult<void, Error>;
  getBytes: (
    id: string,
    context?: TContext,
  ) => AsyncResult<
    { data: ReadableStream; metadata: Record<string, any> },
    Error
  >;
  deleteBytes: (id: string, context?: TContext) => AsyncResult<void, Error>;
};

// Upload types
export type UploadRequest<TContext = DefaultContext> = {
  req: Request;
  context: TContext;
};

export type UploadComplete<TContext = DefaultContext> = {
  req: Request;
  fileId: string;
  metadata: Record<string, any>;
  context: TContext;
};

export type RequestValidationRequest<TContext = DefaultContext> = {
  req: Request;
  fileId: string;
  context: TContext;
};

export type DownloadValidationRequest<TContext = DefaultContext> = {
  req: Request;
  fileId: string;
  context: TContext;
};

export type DownloadValidation<TContext = DefaultContext> = 
  | ((request: DownloadValidationRequest<TContext>) => Promise<{ valid: boolean; error?: string }> | { valid: boolean; error?: string })
  | string
  | undefined;

// Main uploader config
export interface UploaderConfig<
  TContext extends Record<string, any> = DefaultContext,
> {
  // Required storage provider
  storage: BlobStorage<TContext>;

  // Required upload request validation (can validate signatures, auth, rate limits, etc.)
  validateUploadRequest: (
    request: RequestValidationRequest<TContext>,
  ) => SyncOrAsyncResult<void, Error>;

  // Optional download validation
  downloadValidation?: DownloadValidation<TContext>;

  // Optional context generation
  contextFn?: (req: Request) => Promise<TContext> | TContext;

  // Optional lifecycle hooks
  preUpload?: (
    request: UploadRequest<TContext>,
  ) => SyncOrAsyncResult<void, Error>;
  postUpload?: (
    request: UploadComplete<TContext>,
  ) => SyncOrAsyncResult<void, Error>;
}
