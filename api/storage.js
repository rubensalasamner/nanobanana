// api/storage.js
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

const STORAGE_PROVIDER = (process.env.STORAGE_PROVIDER || 'r2').toLowerCase();

// R2 Configuration
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

// Vercel Blob fallback
let vercelBlob;
if (STORAGE_PROVIDER === 'vercel') {
  vercelBlob = await import('@vercel/blob');
}

// Initialize S3 client for R2
let s3Client;
if (STORAGE_PROVIDER === 'r2' && R2_ENDPOINT && R2_BUCKET && R2_ACCESS_KEY && R2_SECRET_KEY) {
  s3Client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY,
      secretAccessKey: R2_SECRET_KEY,
    },
  });
}

/**
 * Upload a file to R2 (S3-compatible API)
 */
async function putR2(filename, buffer, options = {}) {
  if (!s3Client) {
    throw new Error('R2 credentials not configured');
  }

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: filename,
    Body: buffer,
    ContentType: options.contentType || 'application/octet-stream',
  });

  await s3Client.send(command);

  // Return public URL
  const publicUrl = R2_PUBLIC_URL
    ? `${R2_PUBLIC_URL}/${filename}`
    : `${R2_ENDPOINT}/${R2_BUCKET}/${filename}`;

  return { url: publicUrl };
}

/**
 * List objects in R2
 */
async function listR2(options = {}) {
  if (!s3Client) {
    throw new Error('R2 credentials not configured');
  }

  const command = new ListObjectsV2Command({
    Bucket: R2_BUCKET,
    Prefix: options.prefix || '',
    ContinuationToken: options.cursor,
    MaxKeys: 1000,
  });

  const response = await s3Client.send(command);

  return {
    blobs: (response.Contents || []).map((obj) => ({
      pathname: obj.Key,
      uploadedAt: obj.LastModified?.toISOString(),
      size: obj.Size || 0,
    })),
    hasMore: response.IsTruncated || false,
    cursor: response.NextContinuationToken,
  };
}

/**
 * Delete an object from R2
 */
async function delR2(pathname, options = {}) {
  if (!s3Client) {
    throw new Error('R2 credentials not configured');
  }

  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET,
    Key: pathname,
  });

  await s3Client.send(command);
}

// Export functions with same interface as Vercel Blob
export async function put(filename, buffer, options = {}) {
  if (STORAGE_PROVIDER === 'r2') {
    return await putR2(filename, buffer, options);
  } else {
    return await vercelBlob.put(filename, buffer, options);
  }
}

export async function list(options = {}) {
  if (STORAGE_PROVIDER === 'r2') {
    return await listR2(options);
  } else {
    return await vercelBlob.list(options);
  }
}

export async function del(pathname, options = {}) {
  if (STORAGE_PROVIDER === 'r2') {
    return await delR2(pathname, options);
  } else {
    return await vercelBlob.del(pathname, options);
  }
}
