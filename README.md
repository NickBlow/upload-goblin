# @file-goblin/goblin-uploader

An Alchemy-powered file uploader for Cloudflare Workers with R2 and S3 support. Deploy secure, scalable file upload services with just a few lines of code.

## Features

- 🚀 **Alchemy-powered deployment** - Deploy to Cloudflare Workers with zero configuration
- 🔐 **Flexible validation** - HMAC signatures, JWT tokens, API keys, or custom validation
- ☁️ **Multiple storage backends** - Cloudflare R2 and S3-compatible storage
- 📤 **Direct client uploads** - Files upload directly to storage, bypassing your server
- ⚡ **Edge-optimized** - Built for Cloudflare Workers and edge computing
- 🌍 **Unicode support** - Automatic RFC 2047 encoding for S3 compatibility

## Quick Start

### Installation

```bash
bun add @file-goblin/upload-goblin alchemy
```

### Basic Example

Create a simple file uploader with HMAC signature validation:

```typescript
import alchemy from "alchemy";
import { GoblinUploader } from "@file-goblin/upload-goblin";
import { R2Bucket } from "alchemy/cloudflare";

const app = await alchemy("cloudflare-worker", {
  stage: process.env.STAGE || "dev",
});

const uploader = await GoblinUploader("file-uploader", {
  name: "my-file-uploader",
  uploadValidation: alchemy.secret(process.env.UPLOAD_SECRET_KEY),
  storage: {
    type: "r2",
    bucket: await R2Bucket("uploads", {
      name: "my-uploads-bucket"
    })
  }
});

await app.finalize();
```

### Advanced Example with Custom Validation

```typescript
import alchemy from "alchemy";
import { GoblinUploader } from "@file-goblin/goblin-uploader";
import { R2Bucket } from "alchemy/cloudflare";

const app = await alchemy("cloudflare-worker", {
  stage: process.env.STAGE || "dev",
});

const bucket = await R2Bucket("uploads", {
  name: "secure-uploads-bucket"
});

const uploader = await GoblinUploader("secure-uploader", {
  name: "secure-file-uploader",

  // Custom validation with API keys
  uploadValidation: async ({ req, fileId }) => {
    const apiKey = req.headers.get("X-API-Key");
    if (!apiKey) {
      return { valid: false, error: "API key required" };
    }

    // Validate API key (check database, etc.)
    const isValid = await validateApiKey(apiKey);
    if (!isValid) {
      return { valid: false, error: "Invalid API key" };
    }

    // Ensure user can only upload to their own path
    const userId = await getUserIdFromApiKey(apiKey);
    if (!fileId.startsWith(`user-${userId}/`)) {
      return { valid: false, error: "Cannot upload to this path" };
    }

    return { valid: true };
  },

  storage: {
    type: "r2",
    bucket
  },

  // Optional: Add context for tracking
  contextFn: async (req) => ({
    apiKey: req.headers.get("X-API-Key"),
    uploadedAt: new Date().toISOString(),
    userAgent: req.headers.get("User-Agent")
  }),

  // Optional: Post-upload processing
  postUpload: async ({ fileId, metadata, context }) => {
    console.log(`File ${fileId} uploaded by ${context.apiKey}`);

    // Trigger processing pipeline, update database, etc.
    await notifyProcessingService(fileId, metadata);

    return { ok: true, tag: "ok", value: undefined };
  }
});

await app.finalize();
```

## Storage Configuration

### Cloudflare R2

```typescript
import { R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("my-bucket", {
  name: "my-uploads-bucket",
  // Optional: specify credentials
  accessKey: alchemy.secret(process.env.R2_ACCESS_KEY_ID),
  secretAccessKey: alchemy.secret(process.env.R2_SECRET_ACCESS_KEY)
});

const uploader = await GoblinUploader("uploader", {
  name: "my-uploader",
  uploadValidation: "secret-key",
  storage: {
    type: "r2",
    bucket
  }
});
```

### S3-Compatible Storage

```typescript
const uploader = await GoblinUploader("s3-uploader", {
  name: "s3-file-uploader",
  uploadValidation: "secret-key",
  storage: {
    type: "s3",
    region: "us-east-1",
    endpoint: "https://s3.amazonaws.com/my-bucket",
    credentials: {
      accessKeyId: alchemy.secret(process.env.AWS_ACCESS_KEY_ID),
      secretAccessKey: alchemy.secret(process.env.AWS_SECRET_ACCESS_KEY)
    }
  }
});
```

**Note**: S3-compatible storage automatically RFC 2047 encodes Unicode characters in metadata for compatibility.

## Built-in Validation Strategies

### HMAC Signature Validation

Use a secret key for cryptographic signature validation. **Important**: You must generate signatures on your own server, never expose the secret key to clients.

```typescript
// Uploader configuration
const uploader = await GoblinUploader("uploader", {
  name: "signature-uploader",
  uploadValidation: alchemy.secret(process.env.UPLOAD_SECRET_KEY), // String = signature validation
  storage: { type: "r2", bucket }
});
```

**Constraint Enforcement**: The uploader automatically enforces constraints signed in your signature tokens:

```typescript
// Server-side: Generate signature with constraints
const signature = generateUploadSignature({
  fileId: "user-123/document.pdf",
  expiresAt: Date.now() + 30 * 60 * 1000,
  maxFileSize: 5 * 1024 * 1024, // 5MB limit - ENFORCED on upload
  allowedFileType: "application/pdf", // Content-Type must match - ENFORCED
  userId: "user-123"
}, process.env.UPLOAD_SECRET_KEY);

// Wildcard patterns are supported for flexible content type validation:
const anyFileSignature = generateUploadSignature({
  fileId: "user-123/any-file",
  expiresAt: Date.now() + 30 * 60 * 1000,
  allowedFileType: "*", // Allow any content type
}, process.env.UPLOAD_SECRET_KEY);

const imageSignature = generateUploadSignature({
  fileId: "user-123/image",
  expiresAt: Date.now() + 30 * 60 * 1000,
  allowedFileType: "image/*", // Allow any image type (image/jpeg, image/png, etc.)
}, process.env.UPLOAD_SECRET_KEY);
```

**Supported Content Type Patterns:**
- `*` or `*/*` - Allow any content type
- `image/*` - Allow any image type (image/jpeg, image/png, image/gif, etc.)
- `application/*` - Allow any application type (application/pdf, application/json, etc.)
- `text/*` - Allow any text type (text/plain, text/html, etc.)
- `video/*` - Allow any video type
- `application/pdf` - Exact match (traditional behavior)

**All signatures are validated against the actual upload request** - the uploader will reject uploads that exceed the signed `maxFileSize` or don't match the signed `allowedFileType`, preventing signature abuse even with valid tokens.

🚨 **Warning** 🚨: Users can still spoof the Content-Type header. Before you use the file, ensure it matches the expected type.

**Server-side signature generation**: You need to create an API endpoint on your server to generate upload signatures. See the [signature generation examples](./src/examples/) for implementations in TypeScript, Python, and PHP, including a Next.js API route example.

## Client-Side Upload

Once deployed, upload files from your client:

```typescript
// Generate upload signature (server-side)
const signature = generateUploadSignature({
  fileId: `user-${userId}/document.pdf`,
  expiresAt: Date.now() + 30 * 60 * 1000
}, process.env.UPLOAD_SECRET_KEY);

// Upload file (client-side)
```javascript
// Upload a file with PUT request
const uploadResponse = await fetch(`https://your-worker.dev/upload/${fileId}?fileName=${encodeURIComponent(file.name)}`, {
  method: "PUT",
  headers: {
    "Authorization": `Bearer ${signature}`,
    "Content-Type": file.type,
    "X-Metadata-User-Id": userId,
    "X-Metadata-Upload-Source": "web-app"
  },
  body: file
});

if (uploadResponse.ok) {
  const result = await uploadResponse.json();
  console.log("Upload successful:", result);
}

// Download a file as attachment (default)
const downloadResponse = await fetch(`https://your-worker.dev/download/${fileId}`, {
  headers: {
    "Authorization": `Bearer ${downloadSignature}` // Only if download validation is configured
  }
});

// Download a file for inline viewing (e.g., images, PDFs in browser)
const inlineResponse = await fetch(`https://your-worker.dev/download/${fileId}?disposition=inline`);

if (downloadResponse.ok) {
  // File content in response body
  // Metadata available in response headers:
  // Content-Type, Content-Disposition, X-Metadata-*
  const blob = await downloadResponse.blob();
  const fileName = downloadResponse.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1];
}

**Content Disposition Behavior:**
- `attachment` (default): Forces download dialog in browsers - file is saved to disk
- `inline`: Displays content directly in browser when possible (images, PDFs, videos, etc.)
```

## Generated Endpoints

Your deployed worker automatically provides:

- **`PUT /upload/:fileId`** - Upload files with validation
- **`GET /download/:fileId`** - Download files with optional validation
- **Query parameters**:
  - Uploads: `?fileName=example.pdf` (optional)
  - Downloads: `?signature=token` (optional), `?disposition=inline` (optional, defaults to attachment)
- **Headers**: `Authorization`, `Content-Type`, `X-Metadata-*` for custom metadata

## Environment Variables

```bash
# Required for signature validation
UPLOAD_SECRET_KEY=your-secret-key-here

# Required for R2 storage (if not using Alchemy secrets)
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key

# Required for S3 storage
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key

# Optional: Alchemy configuration
ALCHEMY_PASSWORD=your-alchemy-password
BRANCH_PREFIX=dev
```

## Advanced Configuration

### Lifecycle Hooks

```typescript
const uploader = await GoblinUploader("advanced-uploader", {
  name: "advanced-file-uploader",
  uploadValidation: "secret-key",
  storage: { type: "r2", bucket },

  // Pre-upload validation
  preUpload: async ({ req, context }) => {
    const fileSize = parseInt(req.headers.get("Content-Length") || "0");
    if (fileSize > 10 * 1024 * 1024) { // 10MB limit
      return { ok: false, error: { code: 413, message: "File too large" } };
    }
    return { ok: true, tag: "ok", value: undefined };
  },

  // Post-upload processing
  postUpload: async ({ fileId, metadata, context }) => {
    // Send to processing queue
    await queue.send({ fileId, metadata, context });

    // Update database
    await db.files.create({
      id: fileId,
      fileName: metadata.fileName,
      uploadedAt: new Date(),
      userId: context.userId
    });

    return { ok: true, tag: "ok", value: undefined };
  }
});
```

### Custom Context

```typescript
const uploader = await GoblinUploader("context-uploader", {
  name: "context-aware-uploader",
  validation: "secret-key",
  storage: { type: "r2", bucket },

  // Extract context from request
  contextFn: async (req) => {
    const token = req.headers.get("Authorization");
    const user = await validateToken(token);

    return {
      userId: user.id,
      tenantId: user.tenantId,
      permissions: user.permissions,
      ipAddress: req.headers.get("CF-Connecting-IP")
    };
  }
});
```

### Download Configuration

Configure how files can be downloaded:

```typescript
const uploader = await GoblinUploader("download-uploader", {
  name: "file-uploader-with-downloads",
  uploadValidation: "upload-secret-key",
  storage: { type: "r2", bucket },

  // Download validation options:
  downloadValidation: "download-secret-key", // Require signature for downloads
  // OR
  downloadValidation: async ({ req, fileId, context }) => {
    // Custom download validation
    const user = await getCurrentUser(req);
    return fileId.startsWith(`user-${user.id}/`)
      ? { valid: true }
      : { valid: false, error: "Access denied" };
  },
  // OR
  downloadValidation: undefined // Public downloads (no validation)
});
```

## Low-Level Usage (Advanced)

For custom deployment scenarios, you can use the core components directly:

```typescript
import { createUploader, R2BlobStorage, validateSignature } from "@file-goblin/goblin-uploader";

const uploader = createUploader({
  storage: R2BlobStorage(env.MY_BUCKET),
  validateUploadRequest: async ({ req, fileId }) => {
    const signature = req.headers.get("Authorization")?.replace("Bearer ", "");
    const validation = validateSignature(signature, env.UPLOAD_SECRET_KEY, req);
    return validation.valid ? ok() : err({ code: 401, message: validation.error });
  },
  downloadValidation: "download-secret-key" // Optional download validation
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "PUT" && request.url.includes("/upload/")) {
      return uploader.handleUpload(request);
    }
    if (request.method === "GET" && request.url.includes("/download/")) {
      return uploader.handleDownload(request);
    }
    return new Response("Not found", { status: 404 });
  }
};
```

## Testing

```bash
# Run all tests
bun run test

# Run with coverage
bun run test:coverage
```

## License

MIT License - see LICENSE file for details.
