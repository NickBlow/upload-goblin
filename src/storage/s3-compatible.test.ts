import { describe, it, expect } from "vitest";
import { faker } from "@faker-js/faker";
import { S3BlobStorage } from "./s3-compatible";
import { expectNoError } from "../test-helpers/expect-no-error";
import type { Err, Error } from "../config";
import { streamToUintArray } from "./stream-utils";

// Configure the LocalStack endpoint
const localstackConfig = {
  region: "us-east-1",
  endpoint: "http://localhost:4566/test-bucket", // Full endpoint URL including bucket path
  credentials: {
    accessKeyId: "test",
    secretAccessKey: "test"
  }
};

describe("S3 Blob Storage with LocalStack", () => {
  const storage = S3BlobStorage(localstackConfig);

  // Helper to create unique test IDs
  const createTestId = (prefix: string) => `${prefix}-${faker.string.uuid()}`;

  it("should store and retrieve bytes with metadata", async () => {
    const id = createTestId("test");
    const content = new TextEncoder().encode("Hello S3 World").buffer as ArrayBuffer;
    const metadata = { contentType: "text/plain", fileName: "hello.txt" };

    const putResult = await storage.putBytes(id, content, metadata);
    expectNoError(putResult);

    const getResult = await storage.getBytes(id);
    expectNoError(getResult);

    // Check metadata
    expect(getResult.value.metadata.contenttype).toEqual(metadata.contentType);
    expect(getResult.value.metadata.filename).toEqual(metadata.fileName);

    // Check content
    const storedData = getResult.value.data;
    expect(storedData).toBeDefined();

    const storedContent = await streamToUintArray(storedData);
    const originalContent = new Uint8Array(content);

    expect(storedContent.length).toEqual(originalContent.length);
    expect(storedContent).toEqual(originalContent);
  });

  it("should return 404 for non-existent object", async () => {
    const id = createTestId("nonexistent");
    const result = await storage.getBytes(id);

    expect(result.ok).toBe(false);
    expect((result as Err<Error>).error?.code).toBe(404);
  });

  it("should delete an object", async () => {
    const id = createTestId("delete-test");
    const content = new TextEncoder().encode("Delete me").buffer as ArrayBuffer;

    // Put the object
    await storage.putBytes(id, content);

    // Verify it exists
    const checkResult = await storage.getBytes(id);
    expectNoError(checkResult);

    // Consume stream so we don't have hanging connections
    await streamToUintArray(checkResult.value.data);

    // Delete the object
    const deleteResult = await storage.deleteBytes(id);
    expectNoError(deleteResult);

    // Verify it's gone
    const verifyResult = await storage.getBytes(id);
    expect(verifyResult.ok).toBe(false);
    expect((verifyResult as Err<Error>).error?.code).toBe(404);
  });

  it("should work with ReadableStream content", async () => {
    const id = createTestId("stream");
    const text = "Stream content test";

    // Create a ReadableStream from text
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      }
    });

    // Put using stream
    const putResult = await storage.putBytes(id, stream);
    expectNoError(putResult);

    // Get and verify
    const getResult = await storage.getBytes(id);
    expectNoError(getResult);

    const retrievedBytes = await streamToUintArray(getResult.value.data);
    const decoder = new TextDecoder();
    const retrievedText = decoder.decode(retrievedBytes);

    expect(retrievedText).toEqual(text);
  });

  it("should store and retrieve a Blob", async () => {
    const id = createTestId("blob");
    const text = "Blob content test";
    const blob = new Blob([text], { type: "text/plain" });

    const putResult = await storage.putBytes(id, blob);
    expectNoError(putResult);

    const getResult = await storage.getBytes(id);
    expectNoError(getResult);

    const retrievedBytes = await streamToUintArray(getResult.value.data);
    const decoder = new TextDecoder();
    const retrievedText = decoder.decode(retrievedBytes);

    expect(retrievedText).toEqual(text);
  });

  it("should store and retrieve a string", async () => {
    const id = createTestId("string");
    const text = "String content test";

    const putResult = await storage.putBytes(id, text);
    expectNoError(putResult);

    const getResult = await storage.getBytes(id);
    expectNoError(getResult);

    const retrievedBytes = await streamToUintArray(getResult.value.data);
    const decoder = new TextDecoder();
    const retrievedText = decoder.decode(retrievedBytes);

    expect(retrievedText).toEqual(text);
  });

  it("should handle Unicode filenames with RFC 2047 encoding", async () => {
    const id = createTestId("unicode");
    const content = "Unicode filename test";
    const unicodeFilename = "测试文件.txt"; // Chinese characters
    const metadata = { 
      contentType: "text/plain", 
      fileName: unicodeFilename 
    };

    const putResult = await storage.putBytes(id, content, metadata);
    expectNoError(putResult);

    const getResult = await storage.getBytes(id);
    expectNoError(getResult);

    // The filename should be decoded back to original Unicode
    expect(getResult.value.metadata.filename).toEqual(unicodeFilename);

    const retrievedBytes = await streamToUintArray(getResult.value.data);
    const retrievedText = new TextDecoder().decode(retrievedBytes);
    expect(retrievedText).toEqual(content);
  });

  it("should handle ASCII filenames without encoding", async () => {
    const id = createTestId("ascii");
    const content = "ASCII filename test";
    const asciiFilename = "test-file.txt";
    const metadata = { 
      contentType: "text/plain", 
      fileName: asciiFilename 
    };

    const putResult = await storage.putBytes(id, content, metadata);
    expectNoError(putResult);

    const getResult = await storage.getBytes(id);
    expectNoError(getResult);

    // ASCII filename should remain unchanged
    expect(getResult.value.metadata.filename).toEqual(asciiFilename);
  });

  it("should handle complex Unicode filenames", async () => {
    const id = createTestId("complex-unicode");
    const content = "Complex Unicode test";
    const complexFilename = "🚀 файл-тест.pdf"; // Emoji + Cyrillic
    const metadata = { 
      contentType: "application/pdf", 
      fileName: complexFilename 
    };

    const putResult = await storage.putBytes(id, content, metadata);
    expectNoError(putResult);

    const getResult = await storage.getBytes(id);
    expectNoError(getResult);

    expect(getResult.value.metadata.filename).toEqual(complexFilename);
  });

  it("should encode all Unicode metadata with RFC 2047", async () => {
    const id = createTestId("all-unicode-metadata");
    const content = "All Unicode metadata test";
    const metadata = { 
      contentType: "text/plain",
      fileName: "test.txt",
      author: "测试作者", // Unicode author name
      description: "файл описание" // Unicode description
    };

    const putResult = await storage.putBytes(id, content, metadata);
    expectNoError(putResult);

    const getResult = await storage.getBytes(id);
    expectNoError(getResult);

    // All metadata should be RFC 2047 encoded/decoded properly
    expect(getResult.value.metadata.filename).toEqual("test.txt");
    expect(getResult.value.metadata.author).toEqual("测试作者");
    expect(getResult.value.metadata.description).toEqual("файл описание");
  });
});
