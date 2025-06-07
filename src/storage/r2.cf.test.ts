import { describe, it, expect } from "vitest";
import { faker } from "@faker-js/faker";
import { R2BlobStorage } from "./r2";
import { expectNoError } from "../test-helpers/expect-no-error";
import { env } from "cloudflare:test";
import type { Err, Error } from "../config";
import { streamToUintArray } from "./stream-utils";

describe("R2 Blob Storage", () => {
  const testBucket = (env as any).TEST_BUCKET;
  const storage = R2BlobStorage(testBucket);

  it("should store and retrieve bytes with metadata", async () => {
    const id = `test-${faker.string.uuid()}`;
    const content = new TextEncoder().encode("Hello R2 World").buffer as ArrayBuffer;
    const metadata = { contentType: "text/plain", fileName: "hello.txt" };

    const putResult = await storage.putBytes(id, content, metadata);

    expectNoError(putResult);

    const getResult = await storage.getBytes(id);

    expectNoError(getResult);
    expect(getResult.value.metadata).toEqual(metadata);

    const storedData = getResult.value.data;
    expect(storedData).toBeDefined();
    const storedContent = await streamToUintArray(storedData);
    const originalContent = new Uint8Array(content);
    expect(storedContent.length).toEqual(originalContent.length);
    expect(storedContent).toEqual(originalContent);
  });

  it("should return 404 for non-existent object", async () => {
    const id = `nonexistent-${faker.string.uuid()}`;
    const result = await storage.getBytes(id);
    expect(result.ok).toBe(false);
    expect((result as Err<Error>).error?.code).toBe(404);
  });

  it("should delete an object", async () => {
    const id = `delete-test-${faker.string.uuid()}`;
    const content = new TextEncoder().encode("Delete me").buffer as ArrayBuffer;
    await storage.putBytes(id, content);

    const checkResult = await storage.getBytes(id);
    expectNoError(checkResult);
    // consume stream so r2 doesn't explode
    await streamToUintArray(checkResult.value.data);

    const deleteResult = await storage.deleteBytes(id);
    expectNoError(deleteResult);

    const verifyResult = await storage.getBytes(id);
    expect(verifyResult.ok).toBe(false);
    expect((verifyResult as Err<Error>).error?.code).toBe(404);
  });

  it("should work with ReadableStream content", async () => {
    const id = `stream-${faker.string.uuid()}`;
    const text = "Stream content test";
    const request = new Request("https://example.com", {
      method: "POST",
      body: text
    });

    // Use the request's body (which is a ReadableStream) for storage
    const putResult = await storage.putBytes(id, request.body!);
    expectNoError(putResult);

    const getResult = await storage.getBytes(id);
    expectNoError(getResult);

    const retrievedText = await streamToUintArray(getResult.value.data);
    expect(new TextDecoder().decode(retrievedText)).toEqual(text);

  });

  it("should store and retrieve a Blob", async () => {
    const id = `blob-${faker.string.uuid()}`;
    const text = "Blob content test";
    const blob = new Blob([text], { type: "text/plain" });

    const putResult = await storage.putBytes(id, blob);
    expectNoError(putResult);

    const getResult = await storage.getBytes(id);
    expectNoError(getResult);

    const retrievedText = await streamToUintArray(getResult.value.data);
    expect(new TextDecoder().decode(retrievedText)).toEqual(text);
  });
});
