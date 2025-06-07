import crypto from 'node:crypto';

/**
 * Validates an upload signature and enforces signed constraints
 */
export function validateSignature(
  token: string,
  secretKey: string,
  request: Request
): { valid: boolean; payload?: any; error?: string } {
  try {
    const [payloadBase64, signature] = token.split('.');

    if (!payloadBase64 || !signature) {
      return { valid: false, error: 'Invalid token format' };
    }

    // Try to decode and parse the payload first to check format validity
    let payload;
    try {
      const payloadString = Buffer.from(payloadBase64, 'base64url').toString();
      payload = JSON.parse(payloadString);
    } catch (error) {
      return { valid: false, error: 'Invalid token format' };
    }

    const expectedSignature = crypto
      .createHmac('sha256', secretKey)
      .update(payloadBase64)
      .digest('base64url');

    if (signature !== expectedSignature) {
      return { valid: false, error: 'Invalid signature' };
    }

    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: 'Token expired' };
    }

    // Validate signed constraints
    // Validate content type if specified in signature
    if (payload.allowedFileType || payload.allowedMimeType) {
      const contentType = request.headers.get("Content-Type");
      const allowedType = payload.allowedFileType || payload.allowedMimeType;
      
      // Check if content type matches the allowed pattern
      if (!isContentTypeAllowed(contentType, allowedType)) {
        return { 
          valid: false, 
          error: `Content type not allowed. Expected ${allowedType}, got ${contentType}` 
        };
      }
    }
    
    // Validate file size if specified in signature
    if (payload.maxFileSize || payload.maxSizeBytes) {
      const contentLength = parseInt(request.headers.get("Content-Length") || "0");
      const maxSize = payload.maxFileSize || payload.maxSizeBytes;
      
      if (contentLength > maxSize) {
        return { 
          valid: false, 
          error: `File too large. Maximum size: ${maxSize} bytes, got: ${contentLength} bytes` 
        };
      }
    }

    return { valid: true, payload };
  } catch (error) {
    return { valid: false, error: 'Invalid token format' };
  }
}

/**
 * Checks if a content type matches an allowed pattern
 * Supports wildcards: *, star/star, image/star, etc.
 */
function isContentTypeAllowed(contentType: string | null, allowedPattern: string): boolean {
  if (!contentType) {
    return false;
  }

  // Allow everything
  if (allowedPattern === '*' || allowedPattern === '*/*') {
    return true;
  }

  // Wildcard pattern like "image/*"
  if (allowedPattern.endsWith('/*')) {
    const prefix = allowedPattern.slice(0, -2); // Remove "/*"
    return contentType.startsWith(prefix + '/');
  }

  // Exact match
  return contentType === allowedPattern;
}