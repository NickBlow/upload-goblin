import crypto from 'node:crypto';

/**
 * Generates a signed upload token
 */
export function generateUploadSignature(
  payload: { fileId: string; expiresAt: number; [key: string]: any },
  secretKey: string
): string {
  const payloadJson = JSON.stringify(payload);
  const payloadBase64 = Buffer.from(payloadJson).toString('base64url');

  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(payloadBase64)
    .digest('base64url');

  return `${payloadBase64}.${signature}`;
}


