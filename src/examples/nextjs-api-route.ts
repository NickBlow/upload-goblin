// pages/api/uploads/generate-signature.ts
// or app/api/uploads/generate-signature/route.ts (App Router)

import { NextApiRequest, NextApiResponse } from 'next';
import { generateUploadSignature } from '@file-goblin/goblin-uploader';

// Configuration
const UPLOAD_SECRET_KEY = process.env.UPLOAD_SECRET_KEY!;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'text/plain'
];

interface UploadRequest {
  fileName: string;
  fileSize: number;
  fileType: string;
  userId?: string;
  folder?: string;
}

interface UploadResponse {
  signature: string;
  fileId: string;
  uploadUrl: string;
  expiresAt: number;
}

// Pages Router version
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fileName, fileSize, fileType, userId, folder }: UploadRequest = req.body;

    // Validate input
    if (!fileName || !fileSize || !fileType) {
      return res.status(400).json({ 
        error: 'Missing required fields: fileName, fileSize, fileType' 
      });
    }

    // Validate file size
    if (fileSize > MAX_FILE_SIZE) {
      return res.status(400).json({ 
        error: `File too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB` 
      });
    }

    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(fileType)) {
      return res.status(400).json({ 
        error: `File type not allowed. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}` 
      });
    }

    // Generate unique file ID
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    let fileId: string;
    if (userId) {
      fileId = folder 
        ? `user-${userId}/${folder}/${timestamp}-${randomId}-${sanitizedFileName}`
        : `user-${userId}/${timestamp}-${randomId}-${sanitizedFileName}`;
    } else {
      fileId = `uploads/${timestamp}-${randomId}-${sanitizedFileName}`;
    }

    // Set expiration (30 minutes from now)
    const expiresAt = Date.now() + 30 * 60 * 1000;

    // Generate signature
    const signature = generateUploadSignature({
      fileId,
      expiresAt,
      userId,
      maxFileSize: fileSize,
      allowedFileType: fileType,
      fileName: sanitizedFileName
    }, UPLOAD_SECRET_KEY);

    // Your worker URL (replace with your actual deployed worker URL)
    const workerUrl = process.env.UPLOADER_WORKER_URL || 'https://your-uploader.your-subdomain.workers.dev';
    const uploadUrl = `${workerUrl}/uploads/${encodeURIComponent(fileId)}?fileName=${encodeURIComponent(fileName)}`;

    const response: UploadResponse = {
      signature,
      fileId,
      uploadUrl,
      expiresAt
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error generating upload signature:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// App Router version (uncomment if using App Router)
/*
export async function POST(request: Request) {
  try {
    const { fileName, fileSize, fileType, userId, folder }: UploadRequest = await request.json();

    // Validate input
    if (!fileName || !fileSize || !fileType) {
      return Response.json({ 
        error: 'Missing required fields: fileName, fileSize, fileType' 
      }, { status: 400 });
    }

    // Validate file size
    if (fileSize > MAX_FILE_SIZE) {
      return Response.json({ 
        error: `File too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB` 
      }, { status: 400 });
    }

    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(fileType)) {
      return Response.json({ 
        error: `File type not allowed. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}` 
      }, { status: 400 });
    }

    // Generate unique file ID
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    let fileId: string;
    if (userId) {
      fileId = folder 
        ? `user-${userId}/${folder}/${timestamp}-${randomId}-${sanitizedFileName}`
        : `user-${userId}/${timestamp}-${randomId}-${sanitizedFileName}`;
    } else {
      fileId = `uploads/${timestamp}-${randomId}-${sanitizedFileName}`;
    }

    // Set expiration (30 minutes from now)
    const expiresAt = Date.now() + 30 * 60 * 1000;

    // Generate signature
    const signature = generateUploadSignature({
      fileId,
      expiresAt,
      userId,
      maxFileSize: fileSize,
      allowedFileType: fileType,
      fileName: sanitizedFileName
    }, UPLOAD_SECRET_KEY);

    // Your worker URL (replace with your actual deployed worker URL)
    const workerUrl = process.env.UPLOADER_WORKER_URL || 'https://your-uploader.your-subdomain.workers.dev';
    const uploadUrl = `${workerUrl}/uploads/${encodeURIComponent(fileId)}?fileName=${encodeURIComponent(fileName)}`;

    const response: UploadResponse = {
      signature,
      fileId,
      uploadUrl,
      expiresAt
    };

    return Response.json(response);
  } catch (error) {
    console.error('Error generating upload signature:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
*/

// Client-side usage example:
/*
// components/FileUploader.tsx
import React, { useState } from 'react';

interface UploadResponse {
  signature: string;
  fileId: string;
  uploadUrl: string;
  expiresAt: number;
}

export function FileUploader({ userId }: { userId: string }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setProgress(0);

    try {
      // 1. Get upload signature from your API
      const signatureResponse = await fetch('/api/uploads/generate-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          userId,
          folder: 'documents'
        })
      });

      if (!signatureResponse.ok) {
        throw new Error('Failed to get upload signature');
      }

      const { signature, uploadUrl }: UploadResponse = await signatureResponse.json();

      // 2. Upload directly to your Cloudflare Worker
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${signature}`,
          'Content-Type': file.type,
          'X-Metadata-User-Id': userId,
          'X-Metadata-Upload-Source': 'nextjs-app'
        },
        body: file
      });

      if (!uploadResponse.ok) {
        throw new Error('Upload failed');
      }

      const result = await uploadResponse.json();
      console.log('Upload successful:', result);
      setProgress(100);
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <input
        type="file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileUpload(file);
        }}
        disabled={uploading}
      />
      {uploading && <div>Progress: {progress}%</div>}
    </div>
  );
}
*/