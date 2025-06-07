import { describe, it, expect } from "vitest";
import { validateSignature } from "./signature";
import { generateUploadSignature } from "./examples/typescript-signature-generator";

describe("validateSignature", () => {
  const testSecretKey = "test-secret-key-for-testing-purposes-only";

  it("should validate a valid signature", () => {
    const payload = {
      fileId: "user-123/test-file.jpg",
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes from now
      userId: "user-123"
    };
    
    const signature = generateUploadSignature(payload, testSecretKey);
    const request = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" }
    });
    const validation = validateSignature(signature, testSecretKey, request);
    
    expect(validation.valid).toBe(true);
    expect(validation.payload).toEqual(payload);
    expect(validation.error).toBeUndefined();
  });

  it("should reject signature with wrong secret key", () => {
    const payload = {
      fileId: "user-123/test-file.jpg",
      expiresAt: Date.now() + 30 * 60 * 1000
    };
    
    const signature = generateUploadSignature(payload, testSecretKey);
    const request = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" }
    });
    const validation = validateSignature(signature, "wrong-secret-key", request);
    
    expect(validation.valid).toBe(false);
    expect(validation.error).toBe("Invalid signature");
  });

  it("should reject malformed token", () => {
    const request = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" }
    });
    const validation = validateSignature("invalid-token", testSecretKey, request);
    
    expect(validation.valid).toBe(false);
    expect(validation.error).toBe("Invalid token format");
    expect(validation.payload).toBeUndefined();
  });

  it("should reject token with missing parts", () => {
    const request = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" }
    });
    const validation = validateSignature("onlyonepart", testSecretKey, request);
    
    expect(validation.valid).toBe(false);
    expect(validation.error).toBe("Invalid token format");
    expect(validation.payload).toBeUndefined();
  });

  it("should reject expired token", () => {
    const payload = {
      fileId: "user-123/test-file.jpg",
      expiresAt: Date.now() - 1000 // 1 second ago
    };
    
    const signature = generateUploadSignature(payload, testSecretKey);
    const request = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" }
    });
    const validation = validateSignature(signature, testSecretKey, request);
    
    expect(validation.valid).toBe(false);
    expect(validation.error).toBe("Token expired");
  });

  it("should handle token with no payload", () => {
    const request = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" }
    });
    const validation = validateSignature(".signature", testSecretKey, request);
    
    expect(validation.valid).toBe(false);
    expect(validation.error).toBe("Invalid token format");
    expect(validation.payload).toBeUndefined();
  });

  it("should handle token with no signature", () => {
    const request = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" }
    });
    const validation = validateSignature("payload.", testSecretKey, request);
    
    expect(validation.valid).toBe(false);
    expect(validation.error).toBe("Invalid token format");
    expect(validation.payload).toBeUndefined();
  });

  it("should handle invalid base64 payload", () => {
    const request = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" }
    });
    const validation = validateSignature("invalid-base64.signature", testSecretKey, request);
    
    expect(validation.valid).toBe(false);
    expect(validation.error).toBe("Invalid token format");
    expect(validation.payload).toBeUndefined();
  });

  it("should handle invalid JSON payload", () => {
    const invalidJson = Buffer.from("invalid json").toString('base64url');
    const signature = "dummy-signature";
    const request = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" }
    });
    
    const validation = validateSignature(`${invalidJson}.${signature}`, testSecretKey, request);
    
    expect(validation.valid).toBe(false);
    expect(validation.error).toBe("Invalid token format");
    expect(validation.payload).toBeUndefined();
  });

  it("should validate payload with additional fields", () => {
    const payload = {
      fileId: "user-123/test-file.jpg",
      expiresAt: Date.now() + 30 * 60 * 1000,
      userId: "user-123",
      customField: "custom-value",
      maxFileSize: 5000000,
      allowedFileType: "image/jpeg"
    };
    
    const signature = generateUploadSignature(payload, testSecretKey);
    const request = new Request("https://example.com/upload", {
      method: "PUT",
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": "1000"
      }
    });
    const validation = validateSignature(signature, testSecretKey, request);
    
    expect(validation.valid).toBe(true);
    expect(validation.payload).toEqual(payload);
  });

  it("should validate token right at expiration boundary", () => {
    const now = Date.now();
    const validPayload = {
      fileId: "user-123/test-file.jpg",
      expiresAt: now + 100 // 100ms from now
    };
    const expiredPayload = {
      fileId: "user-123/test-file.jpg",
      expiresAt: now - 100 // 100ms ago
    };
    
    const validSignature = generateUploadSignature(validPayload, testSecretKey);
    const expiredSignature = generateUploadSignature(expiredPayload, testSecretKey);
    
    const request = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" }
    });
    
    // Valid token should pass
    const validation1 = validateSignature(validSignature, testSecretKey, request);
    expect(validation1.valid).toBe(true);
    
    // Expired token should fail
    const validation2 = validateSignature(expiredSignature, testSecretKey, request);
    expect(validation2.valid).toBe(false);
    expect(validation2.error).toBe("Token expired");
  });

  it("should validate content type when request is provided", () => {
    const payload = {
      fileId: "user-123/document.pdf",
      expiresAt: Date.now() + 30 * 60 * 1000,
      allowedFileType: "application/pdf"
    };
    
    const signature = generateUploadSignature(payload, testSecretKey);
    const validRequest = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" }
    });
    
    const validation1 = validateSignature(signature, testSecretKey, validRequest);
    expect(validation1.valid).toBe(true);
    
    const invalidRequest = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" }
    });
    
    const validation2 = validateSignature(signature, testSecretKey, invalidRequest);
    expect(validation2.valid).toBe(false);
    expect(validation2.error).toBe("Content type not allowed. Expected application/pdf, got image/jpeg");
  });

  it("should validate file size when request is provided", () => {
    const payload = {
      fileId: "user-123/document.pdf",
      expiresAt: Date.now() + 30 * 60 * 1000,
      maxFileSize: 1000
    };
    
    const signature = generateUploadSignature(payload, testSecretKey);
    const validRequest = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Length": "500" }
    });
    
    const validation1 = validateSignature(signature, testSecretKey, validRequest);
    expect(validation1.valid).toBe(true);
    
    const invalidRequest = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Length": "2000" }
    });
    
    const validation2 = validateSignature(signature, testSecretKey, invalidRequest);
    expect(validation2.valid).toBe(false);
    expect(validation2.error).toBe("File too large. Maximum size: 1000 bytes, got: 2000 bytes");
  });

  it("should validate both content type and file size", () => {
    const payload = {
      fileId: "user-123/document.pdf",
      expiresAt: Date.now() + 30 * 60 * 1000,
      allowedFileType: "application/pdf",
      maxFileSize: 1000
    };
    
    const signature = generateUploadSignature(payload, testSecretKey);
    const validRequest = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { 
        "Content-Type": "application/pdf",
        "Content-Length": "500"
      }
    });
    
    const validation1 = validateSignature(signature, testSecretKey, validRequest);
    expect(validation1.valid).toBe(true);
    
    // Wrong content type should fail first
    const invalidRequest1 = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { 
        "Content-Type": "image/jpeg",
        "Content-Length": "500"
      }
    });
    
    const validation2 = validateSignature(signature, testSecretKey, invalidRequest1);
    expect(validation2.valid).toBe(false);
    expect(validation2.error).toBe("Content type not allowed. Expected application/pdf, got image/jpeg");
    
    // Wrong file size should fail
    const invalidRequest2 = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { 
        "Content-Type": "application/pdf",
        "Content-Length": "2000"
      }
    });
    
    const validation3 = validateSignature(signature, testSecretKey, invalidRequest2);
    expect(validation3.valid).toBe(false);
    expect(validation3.error).toBe("File too large. Maximum size: 1000 bytes, got: 2000 bytes");
  });

  it("should support maxSizeBytes as alternative to maxFileSize", () => {
    const payload = {
      fileId: "user-123/test-file.jpg",
      expiresAt: Date.now() + 30 * 60 * 1000,
      maxSizeBytes: 1000
    };
    
    const signature = generateUploadSignature(payload, testSecretKey);
    const validRequest = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Length": "500" }
    });
    
    const validation1 = validateSignature(signature, testSecretKey, validRequest);
    expect(validation1.valid).toBe(true);
    
    const invalidRequest = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Length": "2000" }
    });
    
    const validation2 = validateSignature(signature, testSecretKey, invalidRequest);
    expect(validation2.valid).toBe(false);
    expect(validation2.error).toBe("File too large. Maximum size: 1000 bytes, got: 2000 bytes");
  });

  it("should support allowedMimeType as alternative to allowedFileType", () => {
    const payload = {
      fileId: "user-123/test-file.jpg",
      expiresAt: Date.now() + 30 * 60 * 1000,
      allowedMimeType: "application/pdf"
    };
    
    const signature = generateUploadSignature(payload, testSecretKey);
    const validRequest = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" }
    });
    
    const validation1 = validateSignature(signature, testSecretKey, validRequest);
    expect(validation1.valid).toBe(true);
    
    const invalidRequest = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" }
    });
    
    const validation2 = validateSignature(signature, testSecretKey, invalidRequest);
    expect(validation2.valid).toBe(false);
    expect(validation2.error).toBe("Content type not allowed. Expected application/pdf, got image/jpeg");
  });

  it("should support wildcard * for any content type", () => {
    const payload = {
      fileId: "user-123/any-file",
      expiresAt: Date.now() + 30 * 60 * 1000,
      allowedFileType: "*"
    };
    
    const signature = generateUploadSignature(payload, testSecretKey);
    
    // Test various content types
    const contentTypes = ["image/jpeg", "application/pdf", "text/plain", "video/mp4"];
    
    for (const contentType of contentTypes) {
      const request = new Request("https://example.com/upload", {
        method: "PUT",
        headers: { "Content-Type": contentType }
      });
      
      const validation = validateSignature(signature, testSecretKey, request);
      expect(validation.valid).toBe(true);
    }
  });

  it("should support wildcard */* for any content type", () => {
    const payload = {
      fileId: "user-123/any-file",
      expiresAt: Date.now() + 30 * 60 * 1000,
      allowedMimeType: "*/*"
    };
    
    const signature = generateUploadSignature(payload, testSecretKey);
    const request = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/unknown" }
    });
    
    const validation = validateSignature(signature, testSecretKey, request);
    expect(validation.valid).toBe(true);
  });

  it("should support wildcard patterns like image/*", () => {
    const payload = {
      fileId: "user-123/image-file",
      expiresAt: Date.now() + 30 * 60 * 1000,
      allowedFileType: "image/*"
    };
    
    const signature = generateUploadSignature(payload, testSecretKey);
    
    // Valid image types
    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    for (const contentType of validTypes) {
      const request = new Request("https://example.com/upload", {
        method: "PUT",
        headers: { "Content-Type": contentType }
      });
      
      const validation = validateSignature(signature, testSecretKey, request);
      expect(validation.valid).toBe(true);
    }
    
    // Invalid non-image types
    const invalidTypes = ["application/pdf", "text/plain", "video/mp4"];
    for (const contentType of invalidTypes) {
      const request = new Request("https://example.com/upload", {
        method: "PUT",
        headers: { "Content-Type": contentType }
      });
      
      const validation = validateSignature(signature, testSecretKey, request);
      expect(validation.valid).toBe(false);
      expect(validation.error).toBe(`Content type not allowed. Expected image/*, got ${contentType}`);
    }
  });

  it("should support wildcard patterns like application/*", () => {
    const payload = {
      fileId: "user-123/app-file",
      expiresAt: Date.now() + 30 * 60 * 1000,
      allowedMimeType: "application/*"
    };
    
    const signature = generateUploadSignature(payload, testSecretKey);
    
    // Valid application types
    const validRequest = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/json" }
    });
    
    const validation1 = validateSignature(signature, testSecretKey, validRequest);
    expect(validation1.valid).toBe(true);
    
    // Invalid type
    const invalidRequest = new Request("https://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" }
    });
    
    const validation2 = validateSignature(signature, testSecretKey, invalidRequest);
    expect(validation2.valid).toBe(false);
    expect(validation2.error).toBe("Content type not allowed. Expected application/*, got image/jpeg");
  });

  it("should reject when content type is missing and wildcard is not used", () => {
    const payload = {
      fileId: "user-123/test-file",
      expiresAt: Date.now() + 30 * 60 * 1000,
      allowedFileType: "image/jpeg"
    };
    
    const signature = generateUploadSignature(payload, testSecretKey);
    const request = new Request("https://example.com/upload", {
      method: "PUT"
      // No Content-Type header
    });
    
    const validation = validateSignature(signature, testSecretKey, request);
    expect(validation.valid).toBe(false);
    expect(validation.error).toBe("Content type not allowed. Expected image/jpeg, got null");
  });
});