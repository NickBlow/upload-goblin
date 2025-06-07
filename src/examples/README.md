# Upload Signature Generation Examples

This directory contains examples of how to generate and validate upload signatures for the @file-goblin/goblin-uploader package in different programming languages and frameworks.

## Overview

When using HMAC signature validation with goblin-uploader, you need to generate signed tokens on your server before clients can upload files. These examples show how to implement the server-side signature generation in various environments.

**Important**: Never expose your secret key to clients. Always generate signatures on your server.

## Token Format

The token format is: `{base64url-encoded-payload}.{base64url-encoded-signature}`

Example payload:
```json
{
  "fileId": "user-123/document.pdf",
  "expiresAt": 1640995200000,
  "userId": "user-123",
  "maxFileSize": 10485760,
  "allowedFileType": "application/pdf"
}
```

## Available Examples

### 1. TypeScript/JavaScript (`typescript-signature-generator.ts`)

Basic signature generation and validation functions:
- `generateUploadSignature(payload, secretKey)` - Creates signed tokens
- `validateSignature(token, secretKey, request)` - Validates tokens

```typescript
import { generateUploadSignature } from '@file-goblin/goblin-uploader';

const signature = generateUploadSignature({
  fileId: 'user-123/document.pdf',
  expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
  userId: 'user-123',
  allowedFileType: 'application/pdf' // Exact match
}, process.env.UPLOAD_SECRET_KEY);

// Wildcard patterns are supported:
const anyFileSignature = generateUploadSignature({
  fileId: 'user-123/any-file',
  expiresAt: Date.now() + 30 * 60 * 1000,
  allowedFileType: '*' // Allow any content type
}, process.env.UPLOAD_SECRET_KEY);

const imageSignature = generateUploadSignature({
  fileId: 'user-123/image',
  expiresAt: Date.now() + 30 * 60 * 1000,
  allowedFileType: 'image/*' // Allow any image type
}, process.env.UPLOAD_SECRET_KEY);
```

### 2. Next.js API Route (`nextjs-api-route.ts`)

Complete example showing:
- Both Pages Router and App Router implementations
- Input validation (file size, type, etc.)
- Unique file ID generation
- Client-side React component example

**Pages Router** (`pages/api/upload/generate-signature.ts`):
```typescript
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { fileName, fileSize, fileType, userId } = req.body;
  
  // Validation logic...
  
  const signature = generateUploadSignature({
    fileId: `user-${userId}/${timestamp}-${randomId}-${fileName}`,
    expiresAt: Date.now() + 30 * 60 * 1000,
    userId,
    maxFileSize: fileSize,
    allowedFileType: fileType
  }, process.env.UPLOAD_SECRET_KEY);
  
  res.json({ signature, fileId, uploadUrl });
}
```

**App Router** (`app/api/upload/generate-signature/route.ts`):
```typescript
export async function POST(request: Request) {
  // Similar implementation with Response.json()
}
```

### 3. Python (`python_signature_generator.py`)

Python implementation with:
- `generate_upload_signature(payload, secret_key)` function
- `validate_upload_signature(token, secret_key)` function
- Example usage patterns

```python
from python_signature_generator import generate_upload_signature
import time

signature = generate_upload_signature({
    'fileId': 'user-123/document.pdf',
    'expiresAt': int((time.time() + 30 * 60) * 1000),
    'userId': 'user-123'
}, os.environ['UPLOAD_SECRET_KEY'])
```

### 4. PHP (`php_signature_generator.php`)

PHP implementation featuring:
- Basic signature functions
- Laravel API route example
- cURL upload example

```php
$signature = generateUploadSignature([
    'fileId' => 'user-123/document.pdf',
    'expiresAt' => (time() + 30 * 60) * 1000,
    'userId' => 'user-123'
], $_ENV['UPLOAD_SECRET_KEY']);
```

## Implementation Guide

### 1. Choose Your Server Technology

Pick the example that matches your server technology:
- **Node.js/TypeScript**: Use `typescript-signature-generator.ts`
- **Next.js**: Use `nextjs-api-route.ts` as a complete reference
- **Python (Django/FastAPI/Flask)**: Use `python_signature_generator.py`
- **PHP (Laravel/Symfony)**: Use `php_signature_generator.php`

### 2. Set Up Environment Variables

All examples require:
```bash
UPLOAD_SECRET_KEY=your-secret-key-here-minimum-32-characters
UPLOADER_WORKER_URL=https://your-uploader.your-subdomain.workers.dev
```

### 3. Create API Endpoint

Create an endpoint that:
1. Validates user authentication
2. Validates file parameters (size, type, etc.)
3. Generates a unique file ID
4. Creates a signed token
5. Returns upload URL and signature

### 4. Client-Side Integration

Your client should:
1. Call your API to get a signed upload URL
2. Upload directly to your Cloudflare Worker
3. Handle upload progress and errors

```javascript
// 1. Get signature from your server
const response = await fetch('/api/upload/generate-signature', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    userId: currentUser.id
  })
});

const { signature, uploadUrl } = await response.json();

// 2. Upload directly to your worker
const uploadResponse = await fetch(uploadUrl, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${signature}`,
    'Content-Type': file.type
  },
  body: file
});
```

## Security Best Practices

1. **Keep secrets secure** - Never expose your UPLOAD_SECRET_KEY to clients
2. **Validate everything** - Check file size, type, user permissions
3. **Use reasonable expiration** - 15-30 minutes is typically sufficient
4. **Generate unique file IDs** - Prevent collisions and unauthorized access
5. **Implement rate limiting** - Prevent abuse of your signature endpoint
6. **Log upload activity** - Monitor for suspicious patterns
7. **Always sign constraints** - Include `maxFileSize` and `allowedFileType` in signatures to enforce limits
8. **Use specific content types** - Don't allow broad types like `*/*` in signatures
9. **Validate on both ends** - Server validates before signing, uploader validates during upload

## Common Payload Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fileId` | string | ✅ | Unique identifier for the file |
| `expiresAt` | number | ✅ | Unix timestamp in milliseconds |
| `userId` | string | ❌ | User identifier for tracking |
| `maxFileSize` | number | ❌ | Maximum allowed file size in bytes (enforced on upload) |
| `allowedFileType` | string | ❌ | MIME type restriction (enforced on upload). Supports wildcards: `*`, `*/*`, `image/*`, etc. |
| `fileName` | string | ❌ | Original filename for metadata |

**Constraint Enforcement**: The uploader **always** validates any constraints included in your signature against the actual upload request. This prevents signature abuse - even with a valid signature, users cannot upload files that exceed the signed size limit or don't match the signed content type. All signatures are validated against the request headers to ensure the upload matches what was authorized.

**Content Type Patterns**: The `allowedFileType` field supports flexible patterns:
- `*` or `*/*` - Allow any content type
- `image/*` - Allow any image type (image/jpeg, image/png, image/gif, etc.)
- `application/*` - Allow any application type (application/pdf, application/json, etc.)
- `text/*` - Allow any text type (text/plain, text/html, etc.)
- `video/*` - Allow any video type
- `application/pdf` - Exact match (traditional behavior)

## Error Handling

Your signature generation endpoint should handle:
- **Invalid file types**: Return 400 with allowed types
- **File too large**: Return 413 with size limits
- **Unauthorized access**: Return 401/403
- **Rate limiting**: Return 429 with retry info
- **Server errors**: Return 500 with generic message

## Testing

Each example includes test functions you can run:

```bash
# TypeScript
npm install && node -r ts-node/register typescript-signature-generator.ts

# Python
python python_signature_generator.py

# PHP
php php_signature_generator.php
```

## Integration with Goblin Uploader

These signature generators work with the goblin-uploader Alchemy resource configured for HMAC validation:

```typescript
const uploader = await GoblinUploader("uploader", {
  name: "my-uploader",
  validation: await alchemy.secret.env.UPLOAD_SECRET_KEY, // String = HMAC validation
  storage: { type: "r2", bucket }
});
```

The uploader will automatically validate signatures using the same secret key you use to generate them.