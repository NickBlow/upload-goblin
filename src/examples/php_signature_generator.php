<?php

/**
 * Generates a signed upload token
 */
function generateUploadSignature(array $payload, string $secretKey): string {
    $payloadJson = json_encode($payload, JSON_UNESCAPED_SLASHES);
    $payloadBase64 = rtrim(base64_encode($payloadJson), '=');
    $payloadBase64 = strtr($payloadBase64, '+/', '-_');
    
    $signature = hash_hmac('sha256', $payloadBase64, $secretKey, true);
    $signatureBase64 = rtrim(base64_encode($signature), '=');
    $signatureBase64 = strtr($signatureBase64, '+/', '-_');
    
    return $payloadBase64 . '.' . $signatureBase64;
}

/**
 * Validates an upload signature
 */
function validateUploadSignature(string $token, string $secretKey): array {
    try {
        $parts = explode('.', $token);
        if (count($parts) !== 2) {
            return ['valid' => false, 'error' => 'Invalid token format'];
        }
        
        [$payloadBase64, $signatureBase64] = $parts;
        
        $expectedSignature = hash_hmac('sha256', $payloadBase64, $secretKey, true);
        $expectedSignatureBase64 = rtrim(base64_encode($expectedSignature), '=');
        $expectedSignatureBase64 = strtr($expectedSignatureBase64, '+/', '-_');
        
        if ($signatureBase64 !== $expectedSignatureBase64) {
            return ['valid' => false, 'error' => 'Invalid signature'];
        }
        
        $payloadBase64 = strtr($payloadBase64, '-_', '+/');
        $padding = 4 - strlen($payloadBase64) % 4;
        if ($padding !== 4) {
            $payloadBase64 .= str_repeat('=', $padding);
        }
        
        $payloadJson = base64_decode($payloadBase64);
        $payload = json_decode($payloadJson, true);
        
        if ($payload === null) {
            return ['valid' => false, 'error' => 'Invalid token format'];
        }
        
        if (isset($payload['expiresAt']) && time() * 1000 > $payload['expiresAt']) {
            return ['valid' => false, 'error' => 'Token expired'];
        }
        
        return ['valid' => true, 'payload' => $payload];
        
    } catch (Exception $e) {
        return ['valid' => false, 'error' => 'Invalid token format'];
    }
}

/**
 * Example Laravel API route for generating upload signatures
 */
function exampleLaravelRoute() {
    // routes/api.php
    /*
    Route::post('/uploads/generate-signature', function (Request $request) {
        $request->validate([
            'fileName' => 'required|string|max:255',
            'fileSize' => 'required|integer|max:10485760', // 10MB
            'fileType' => 'required|string',
            'userId' => 'nullable|string',
            'folder' => 'nullable|string'
        ]);

        $allowedTypes = ['image/jpeg', 'image/png', 'application/pdf', 'text/plain'];
        if (!in_array($request->fileType, $allowedTypes)) {
            return response()->json(['error' => 'File type not allowed'], 400);
        }

        // Generate unique file ID
        $timestamp = time();
        $randomId = Str::random(10);
        $sanitizedFileName = preg_replace('/[^a-zA-Z0-9.-]/', '_', $request->fileName);
        
        if ($request->userId) {
            $fileId = $request->folder 
                ? "user-{$request->userId}/{$request->folder}/{$timestamp}-{$randomId}-{$sanitizedFileName}"
                : "user-{$request->userId}/{$timestamp}-{$randomId}-{$sanitizedFileName}";
        } else {
            $fileId = "uploads/{$timestamp}-{$randomId}-{$sanitizedFileName}";
        }

        // Set expiration (30 minutes from now)
        $expiresAt = (time() + 30 * 60) * 1000; // Convert to milliseconds

        // Generate signature
        $signature = generateUploadSignature([
            'fileId' => $fileId,
            'expiresAt' => $expiresAt,
            'userId' => $request->userId,
            'maxFileSize' => $request->fileSize,
            'allowedFileType' => $request->fileType,
            'fileName' => $sanitizedFileName
        ], env('UPLOAD_SECRET_KEY'));

        $workerUrl = env('UPLOADER_WORKER_URL', 'https://your-uploader.your-subdomain.workers.dev');
        $uploadUrl = "{$workerUrl}/uploads/" . urlencode($fileId) . "?fileName=" . urlencode($request->fileName);

        return response()->json([
            'signature' => $signature,
            'fileId' => $fileId,
            'uploadUrl' => $uploadUrl,
            'expiresAt' => $expiresAt
        ]);
    });
    */
}

/**
 * Example usage in plain PHP
 */
function exampleUsage() {
    $secretKey = $_ENV['UPLOAD_SECRET_KEY'] ?? 'your-secret-key-here';
    
    // Generate signature
    $payload = [
        'fileId' => 'user-123/document.pdf',
        'expiresAt' => (time() + 30 * 60) * 1000, // 30 minutes from now
        'userId' => 'user-123'
    ];
    
    $signature = generateUploadSignature($payload, $secretKey);
    echo "Generated signature: " . $signature . "\n";
    
    // Validate signature
    $validation = validateUploadSignature($signature, $secretKey);
    if ($validation['valid']) {
        echo "Signature is valid!\n";
        print_r($validation['payload']);
    } else {
        echo "Signature validation failed: " . $validation['error'] . "\n";
    }
}

// Example client-side upload using cURL
function exampleClientUpload(string $uploadUrl, string $signature, string $filePath): array {
    if (!file_exists($filePath)) {
        throw new Exception("File not found: $filePath");
    }
    
    $fileSize = filesize($filePath);
    $fileName = basename($filePath);
    $contentType = mime_content_type($filePath) ?: 'application/octet-stream';
    
    $headers = [
        'Authorization: Bearer ' . $signature,
        'Content-Type: ' . $contentType,
        'X-Metadata-Upload-Source: php-app'
    ];
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $uploadUrl,
        CURLOPT_CUSTOMREQUEST => 'PUT',
        CURLOPT_POSTFIELDS => file_get_contents($filePath),
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => false
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error) {
        throw new Exception("cURL error: $error");
    }
    
    if ($httpCode >= 400) {
        throw new Exception("Upload failed: HTTP $httpCode - $response");
    }
    
    return json_decode($response, true) ?? ['response' => $response];
}

// Run example if called directly
if (php_sapi_name() === 'cli') {
    echo "PHP Upload Signature Generator Example\n";
    echo "=====================================\n\n";
    exampleUsage();
}