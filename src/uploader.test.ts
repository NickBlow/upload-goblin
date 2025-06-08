import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUploader } from "./uploader";
import { ok, err } from "./config";
import type { BlobStorage, UploaderConfig } from "./config";
import { streamToUintArray } from "./storage/stream-utils";

// Mock storage implementation
const createMockStorage = (): BlobStorage => ({
  putBytes: vi.fn().mockResolvedValue(ok(undefined)),
  getBytes: vi.fn().mockResolvedValue(
    ok({
      data: new ReadableStream(),
      metadata: {},
    }),
  ),
  deleteBytes: vi.fn().mockResolvedValue(ok(undefined)),
});

describe("Uploader", () => {
  const mockStorage = createMockStorage();
  const mockValidateUploadRequest = vi.fn().mockResolvedValue(ok(undefined));

  const baseConfig: UploaderConfig = {
    storage: mockStorage,
    validateUploadRequest: mockValidateUploadRequest,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle successful upload with valid signature", async () => {
    const uploader = createUploader(baseConfig);

    const request = new Request(
      "https://example.com/uploads/test-file-123?fileName=test.jpg",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer valid-signature",
          "Content-Type": "image/jpeg",
          "Content-Length": "1024",
        },
        body: "test file content",
      },
    );

    const response = await uploader.handleUpload(request);
    const result = await response.json<any>();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.fileId).toBe("test-file-123");
    expect(mockValidateUploadRequest).toHaveBeenCalledWith({
      req: request,
      fileId: "test-file-123",
      context: {},
    });
    expect(mockStorage.putBytes).toHaveBeenCalledWith(
      "test-file-123",
      expect.any(ReadableStream),
      {
        contentType: "image/jpeg",
        contentLength: 1024,
        fileName: "test.jpg",
      },
      {},
    );
  });

  it("should reject upload with invalid signature", async () => {
    const mockValidateUploadRequest = vi
      .fn()
      .mockResolvedValue(err({ code: 401, message: "Invalid signature" }));

    const uploader = createUploader({
      ...baseConfig,
      validateUploadRequest: mockValidateUploadRequest,
    });

    const request = new Request("https://example.com/uploads/test-file-123", {
      method: "PUT",
      headers: {
        Authorization: "Bearer invalid-signature",
        "Content-Type": "image/jpeg",
      },
      body: "test file content",
    });

    const response = await uploader.handleUpload(request);
    const result = await response.json<any>();

    expect(response.status).toBe(401);
    expect(result.error).toBe("Request validation failed");
    expect(result.details).toBe("Invalid signature");
  });

  it("should handle request validation failure", async () => {
    const mockValidateUploadRequest = vi
      .fn()
      .mockResolvedValue(err({ code: 400, message: "Bad request" }));

    const uploader = createUploader({
      ...baseConfig,
      validateUploadRequest: mockValidateUploadRequest,
    });

    const request = new Request("https://example.com/uploads/test-file-123", {
      method: "PUT",
      body: "test file content",
    });

    const response = await uploader.handleUpload(request);
    const result = await response.json<any>();

    expect(response.status).toBe(400);
    expect(result.error).toBe("Request validation failed");
  });

  it("should handle missing file ID", async () => {
    const uploader = createUploader(baseConfig);

    const request = new Request("https://example.com/uploads/", {
      method: "PUT",
      body: "test file content",
    });

    const response = await uploader.handleUpload(request);
    const result = await response.json<any>();

    expect(response.status).toBe(400);
    expect(result.error).toBe("File ID is required");
  });

  it("should handle missing request body", async () => {
    const uploader = createUploader(baseConfig);

    const request = new Request("https://example.com/uploads/test-file-123", {
      method: "PUT",
    });

    const response = await uploader.handleUpload(request);
    const result = await response.json<any>();

    expect(response.status).toBe(400);
    expect(result.error).toBe("Request body is required");
  });

  it("should call pre-upload hook when configured", async () => {
    const mockPreUpload = vi.fn().mockResolvedValue(ok(undefined));
    const uploader = createUploader({
      ...baseConfig,
      preUpload: mockPreUpload,
    });

    const request = new Request("https://example.com/uploads/test-file-123", {
      method: "PUT",
      body: "test file content",
    });

    await uploader.handleUpload(request);

    expect(mockPreUpload).toHaveBeenCalledWith({
      req: request,
      context: {},
    });
  });

  describe("Download", () => {
    const mockStorage = createMockStorage();

    const baseConfig: UploaderConfig = {
      storage: mockStorage,
      validateUploadRequest: vi.fn().mockResolvedValue(ok(undefined)),
    };

    beforeEach(() => {
      vi.clearAllMocks();
      (mockStorage.getBytes as any).mockResolvedValue(
        ok({
          data: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("test file content"));
              controller.close();
            },
          }),
          metadata: {
            contentType: "text/plain",
            fileName: "test.txt",
            customField: "custom-value",
          },
        }),
      );
    });

    it("should handle public download without validation", async () => {
      const uploader = createUploader(baseConfig);

      const request = new Request("https://example.com/uploads/test-file-123");

      const response = await uploader.handleDownload(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/plain");
      expect(response.headers.get("Content-Disposition")).toBe(
        'attachment; filename="test.txt"',
      );
      expect(response.headers.get("X-Metadata-customField")).toBe(
        "custom-value",
      );
      expect(mockStorage.getBytes).toHaveBeenCalledWith("test-file-123", {});
    });

    it("should require signature when string validation is provided", async () => {
      const uploader = createUploader({
        ...baseConfig,
        downloadValidation: "secret-key",
      });

      const request = new Request("https://example.com/uploads/test-file-123");

      const response = await uploader.handleDownload(request);
      const result = await response.json<any>();

      expect(response.status).toBe(401);
      expect(result.error).toBe("Signature required for download");
    });

    it("should handle custom validation function", async () => {
      const mockDownloadValidation = vi.fn().mockResolvedValue({ valid: true });
      const uploader = createUploader({
        ...baseConfig,
        downloadValidation: mockDownloadValidation,
      });

      const request = new Request("https://example.com/uploads/test-file-123");

      const response = await uploader.handleDownload(request);

      expect(response.status).toBe(200);
      expect(mockDownloadValidation).toHaveBeenCalledWith({
        req: request,
        fileId: "test-file-123",
        context: {},
      });
    });

    it("should reject download when custom validation fails", async () => {
      const mockDownloadValidation = vi.fn().mockResolvedValue({
        valid: false,
        error: "Access denied",
      });
      const uploader = createUploader({
        ...baseConfig,
        downloadValidation: mockDownloadValidation,
      });

      const request = new Request("https://example.com/uploads/test-file-123");

      const response = await uploader.handleDownload(request);
      const result = await response.json<any>();

      expect(response.status).toBe(403);
      expect(result.error).toBe("Download validation failed");
      expect(result.details).toBe("Access denied");
    });

    it("should handle missing file ID", async () => {
      const uploader = createUploader(baseConfig);

      const request = new Request("https://example.com/uploads/");

      const response = await uploader.handleDownload(request);
      const result = await response.json<any>();

      expect(response.status).toBe(400);
      expect(result.error).toBe("File ID is required");
    });

    it("should handle file not found", async () => {
      (mockStorage.getBytes as any).mockResolvedValue(
        err({ code: 404, message: "File not found" }),
      );

      const uploader = createUploader(baseConfig);

      const request = new Request("https://example.com/uploads/missing-file");

      const response = await uploader.handleDownload(request);
      const result = await response.json<any>();

      expect(response.status).toBe(404);
      expect(result.error).toBe("File not found");
    });

    it("should set default content type when not in metadata", async () => {
      (mockStorage.getBytes as any).mockResolvedValue(
        ok({
          data: new ReadableStream(),
          metadata: {
            fileName: "test.txt",
          },
        }),
      );

      const uploader = createUploader(baseConfig);

      const request = new Request("https://example.com/uploads/test-file-123");

      const response = await uploader.handleDownload(request);

      expect(response.headers.get("Content-Type")).toBe(
        "application/octet-stream",
      );
    });

    it("should set CORS headers for browser downloads", async () => {
      const uploader = createUploader(baseConfig);

      const request = new Request("https://example.com/uploads/test-file-123");

      const response = await uploader.handleDownload(request);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Expose-Headers")).toBe("*");
    });

    it("should use attachment disposition by default", async () => {
      const uploader = createUploader(baseConfig);

      const request = new Request("https://example.com/uploads/test-file-123");

      const response = await uploader.handleDownload(request);

      expect(response.headers.get("Content-Disposition")).toBe(
        'attachment; filename="test.txt"',
      );
    });

    it("should use inline disposition when specified in query parameter", async () => {
      const uploader = createUploader(baseConfig);

      const request = new Request(
        "https://example.com/uploads/test-file-123?disposition=inline",
      );

      const response = await uploader.handleDownload(request);

      expect(response.headers.get("Content-Disposition")).toBe(
        'inline; filename="test.txt"',
      );
    });

    it("should default to attachment for invalid disposition values", async () => {
      const uploader = createUploader(baseConfig);

      const request = new Request(
        "https://example.com/uploads/test-file-123?disposition=invalid",
      );

      const response = await uploader.handleDownload(request);

      expect(response.headers.get("Content-Disposition")).toBe(
        'attachment; filename="test.txt"',
      );
    });

    it("should use custom context function for downloads", async () => {
      const mockContextFn = vi.fn().mockResolvedValue({ userId: "123" });
      const uploader = createUploader({
        ...baseConfig,
        contextFn: mockContextFn,
      });

      const request = new Request("https://example.com/uploads/test-file-123");

      await uploader.handleDownload(request);

      expect(mockContextFn).toHaveBeenCalledWith(request);
      expect(mockStorage.getBytes).toHaveBeenCalledWith("test-file-123", {
        userId: "123",
      });
    });
  });

  it("should pass correct stream data to storage", async () => {
    const testContent = "test file content for stream verification";
    const capturedData: any[] = [];

    // Create a mock storage that captures the stream data
    const mockStorage = createMockStorage();
    (mockStorage.putBytes as any).mockImplementation(
      async (id: string, content: any, metadata: any, context: any) => {
        // Capture the stream data for verification
        if (content instanceof ReadableStream) {
          const data = await streamToUintArray(content);
          capturedData.push(new TextDecoder().decode(data));
        } else {
          capturedData.push(content);
        }
        return ok(undefined);
      },
    );

    const uploader = createUploader({
      ...baseConfig,
      storage: mockStorage,
    });

    const request = new Request("https://example.com/uploads/test-file-123", {
      method: "PUT",
      headers: {
        "Content-Type": "text/plain",
      },
      body: testContent,
    });

    const response = await uploader.handleUpload(request);
    const result = await response.json<any>();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(capturedData).toHaveLength(1);
    expect(capturedData[0]).toBe(testContent);

    // Verify storage was called with the stream
    expect(mockStorage.putBytes).toHaveBeenCalledWith(
      "test-file-123",
      expect.any(ReadableStream),
      {
        contentType: "text/plain",
      },
      {},
    );
  });

  it("should pass correct binary stream data to storage", async () => {
    // Create binary test data (simulating an image or other binary file)
    const binaryData = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]); // PNG header
    const capturedData: Uint8Array[] = [];

    // Create a mock storage that captures the stream data
    const mockStorage = createMockStorage();
    (mockStorage.putBytes as any).mockImplementation(
      async (id: string, content: any, metadata: any, context: any) => {
        // Capture the stream data for verification
        if (content instanceof ReadableStream) {
          const data = await streamToUintArray(content);
          capturedData.push(data);
        } else {
          capturedData.push(content);
        }
        return ok(undefined);
      },
    );

    const uploader = createUploader({
      ...baseConfig,
      storage: mockStorage,
    });

    const request = new Request("https://example.com/uploads/image-file-123", {
      method: "PUT",
      headers: {
        "Content-Type": "image/png",
        "Content-Length": binaryData.length.toString(),
      },
      body: binaryData,
    });

    const response = await uploader.handleUpload(request);
    const result = await response.json<any>();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(capturedData).toHaveLength(1);

    // Verify the binary data matches exactly
    const capturedBytes = capturedData[0]!;
    expect(capturedBytes).toBeDefined();
    expect(capturedBytes).toEqual(binaryData);
    expect(capturedBytes.length).toBe(binaryData.length);

    // Verify storage was called with the stream
    expect(mockStorage.putBytes).toHaveBeenCalledWith(
      "image-file-123",
      expect.any(ReadableStream),
      {
        contentType: "image/png",
        contentLength: binaryData.length,
      },
      {},
    );
  });

  it("should handle large file streams correctly", async () => {
    // Create a large test file (10KB of repeated pattern)
    const chunkSize = 1024;
    const numChunks = 10;
    const pattern = "0123456789abcdef";
    let expectedContent = "";

    // Build expected content
    for (let i = 0; i < numChunks; i++) {
      for (let j = 0; j < chunkSize / pattern.length; j++) {
        expectedContent += pattern;
      }
    }

    const capturedData: Uint8Array[] = [];

    // Create a mock storage that captures the stream data
    const mockStorage = createMockStorage();
    (mockStorage.putBytes as any).mockImplementation(
      async (id: string, content: any, metadata: any, context: any) => {
        if (content instanceof ReadableStream) {
          const data = await streamToUintArray(content);
          capturedData.push(data);
        }
        return ok(undefined);
      },
    );

    const uploader = createUploader({
      ...baseConfig,
      storage: mockStorage,
    });

    // Create a large file using ReadableStream
    const largeFileStream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < numChunks; i++) {
          const chunk = new TextEncoder().encode(
            expectedContent.slice(i * chunkSize, (i + 1) * chunkSize),
          );
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    const request = new Request("https://example.com/uploads/large-file-123", {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": expectedContent.length.toString(),
      },
      body: largeFileStream,
      ...({ duplex: "half" } as any),
    });

    const response = await uploader.handleUpload(request);
    const result = await response.json<any>();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(capturedData).toHaveLength(1);

    // Verify the large file data matches exactly
    const capturedBytes = capturedData[0]!;
    expect(capturedBytes).toBeDefined();
    const capturedText = new TextDecoder().decode(capturedBytes);
    expect(capturedText).toBe(expectedContent);
    expect(capturedBytes.length).toBe(expectedContent.length);

    // Verify storage was called with the stream
    expect(mockStorage.putBytes).toHaveBeenCalledWith(
      "large-file-123",
      expect.any(ReadableStream),
      {
        contentType: "application/octet-stream",
        contentLength: expectedContent.length,
      },
      {},
    );
  });

  it("should call post-upload hook when configured", async () => {
    const mockPostUpload = vi.fn().mockResolvedValue(ok(undefined));
    const uploader = createUploader({
      ...baseConfig,
      postUpload: mockPostUpload,
    });

    const request = new Request(
      "https://example.com/uploads/test-file-123?fileName=test.jpg",
      {
        method: "PUT",
        headers: {
          "Content-Type": "image/jpeg",
        },
        body: "test file content",
      },
    );

    await uploader.handleUpload(request);

    expect(mockPostUpload).toHaveBeenCalledWith({
      req: request,
      fileId: "test-file-123",
      metadata: {
        contentType: "image/jpeg",
        fileName: "test.jpg",
      },
      context: {},
    });
  });

  it("should reject upload when pre-upload hook fails", async () => {
    const mockPreUpload = vi
      .fn()
      .mockResolvedValue(err({ code: 403, message: "Forbidden" }));
    const uploader = createUploader({
      ...baseConfig,
      preUpload: mockPreUpload,
    });

    const request = new Request("https://example.com/uploads/test-file-123", {
      method: "PUT",
      body: "test file content",
    });

    const response = await uploader.handleUpload(request);
    const result = await response.json<any>();

    expect(response.status).toBe(403);
    expect(result.error).toBe("Pre-upload validation failed");
    expect(result.details).toBe("Forbidden");
  });

  it("should extract metadata from custom headers", async () => {
    const uploader = createUploader(baseConfig);

    const request = new Request("https://example.com/uploads/test-file-123", {
      method: "PUT",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Metadata-User-Id": "123",
        "X-Metadata-Tag": "important",
      },
      body: "test file content",
    });

    await uploader.handleUpload(request);

    expect(mockStorage.putBytes).toHaveBeenCalledWith(
      "test-file-123",
      expect.any(ReadableStream),
      {
        contentType: "image/jpeg",
        "User-Id": "123",
        Tag: "important",
      },
      {},
    );
  });

  it("should call validateUploadRequest with correct parameters", async () => {
    const uploader = createUploader(baseConfig);

    const request = new Request("https://example.com/uploads/test-file-123", {
      method: "PUT",
      body: "test file content",
    });

    await uploader.handleUpload(request);

    expect(mockValidateUploadRequest).toHaveBeenCalledWith({
      req: request,
      fileId: "test-file-123",
      context: {},
    });
  });

  it("should handle storage errors gracefully", async () => {
    const mockStorage = createMockStorage();
    (mockStorage.putBytes as any).mockResolvedValue(
      err({ code: 500, message: "Storage error" }),
    );

    const uploader = createUploader({
      ...baseConfig,
      storage: mockStorage,
    });

    const request = new Request("https://example.com/uploads/test-file-123", {
      method: "PUT",
      body: "test file content",
    });

    const response = await uploader.handleUpload(request);
    const result = await response.json<any>();

    expect(response.status).toBe(500);
    expect(result.error).toBe("Failed to store file");
    expect(result.details).toBe("Storage error");
  });

  it("should continue upload even if post-upload hook fails", async () => {
    const mockPostUpload = vi
      .fn()
      .mockResolvedValue(err({ code: 500, message: "Hook failed" }));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const uploader = createUploader({
      ...baseConfig,
      postUpload: mockPostUpload,
    });

    const request = new Request("https://example.com/uploads/test-file-123", {
      method: "PUT",
      body: "test file content",
    });

    const response = await uploader.handleUpload(request);
    const result = await response.json<any>();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      "Post-upload hook failed:",
      expect.objectContaining({
        code: 500,
        message: "Hook failed",
      }),
    );

    consoleSpy.mockRestore();
  });

  it("should use custom context function when provided", async () => {
    const mockContextFn = vi.fn().mockResolvedValue({ userId: "123" });
    const uploader = createUploader({
      ...baseConfig,
      contextFn: mockContextFn,
    });

    const request = new Request("https://example.com/uploads/test-file-123", {
      method: "PUT",
      body: "test file content",
    });

    await uploader.handleUpload(request);

    expect(mockContextFn).toHaveBeenCalledWith(request);
    expect(mockValidateUploadRequest).toHaveBeenCalledWith({
      req: request,
      fileId: "test-file-123",
      context: { userId: "123" },
    });
  });

  it("should extract fileName from query string", async () => {
    const uploader = createUploader(baseConfig);

    const request = new Request(
      "https://example.com/uploads/test-file-123?fileName=my-file.pdf",
      {
        method: "PUT",
        body: "test file content",
      },
    );

    await uploader.handleUpload(request);

    expect(mockStorage.putBytes).toHaveBeenCalledWith(
      "test-file-123",
      expect.any(ReadableStream),
      expect.objectContaining({
        fileName: "my-file.pdf",
      }),
      {},
    );
  });

  it("should work without fileName query parameter", async () => {
    const uploader = createUploader(baseConfig);

    const request = new Request("https://example.com/uploads/test-file-123", {
      method: "PUT",
      body: "test file content",
    });

    await uploader.handleUpload(request);

    expect(mockStorage.putBytes).toHaveBeenCalledWith(
      "test-file-123",
      expect.any(ReadableStream),
      expect.any(Object),
      {},
    );
  });
});
