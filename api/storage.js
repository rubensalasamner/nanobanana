// api/storage.js
import aws4 from 'aws4';
import crypto from 'crypto';

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

/**
 * Upload a file to R2 (S3-compatible API)
 */
async function putR2(filename, buffer, options = {}) {
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY || !R2_SECRET_KEY) {
    throw new Error('R2 credentials not configured');
  }

  const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}/${filename}`);

  // Calculate SHA256 hash of the body
  const bodyHash = crypto.createHash('sha256').update(buffer).digest('hex');

  const opts = {
    host: url.hostname,
    path: url.pathname,
    method: 'PUT',
    headers: {
      'Content-Type': options.contentType || 'application/octet-stream',
      'x-amz-content-sha256': bodyHash,
    },
    body: buffer,
  };

  aws4.sign(opts, {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  });

  const response = await fetch(url.toString(), {
    method: 'PUT',
    headers: opts.headers,
    body: buffer,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`R2 upload failed: ${response.status} ${text}`);
  }

  // Return public URL
  const publicUrl = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${filename}` : `${url.origin}/${filename}`;

  return { url: publicUrl };
}

/**
 * Parse XML response from S3 ListObjectsV2
 */
function parseListResponse(xml) {
  const blobs = [];

  // Extract keys
  const keyRegex = /<Key>(.*?)<\/Key>/g;
  let keyMatch;
  const keys = [];
  while ((keyMatch = keyRegex.exec(xml)) !== null) {
    keys.push(keyMatch[1]);
  }

  // Extract last modified dates
  const dateRegex = /<LastModified>(.*?)<\/LastModified>/g;
  let dateMatch;
  const dates = [];
  while ((dateMatch = dateRegex.exec(xml)) !== null) {
    dates.push(dateMatch[1]);
  }

  // Extract sizes
  const sizeRegex = /<Size>(.*?)<\/Size>/g;
  let sizeMatch;
  const sizes = [];
  while ((sizeMatch = sizeRegex.exec(xml)) !== null) {
    sizes.push(parseInt(sizeMatch[1], 10));
  }

  // Combine into blob objects
  keys.forEach((key, i) => {
    blobs.push({
      pathname: key,
      uploadedAt: dates[i] || new Date().toISOString(),
      size: sizes[i] || 0,
    });
  });

  // Check if truncated
  const isTruncated = xml.includes('<IsTruncated>true</IsTruncated>');

  // Get continuation token
  const tokenMatch = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/);
  const nextCursor = tokenMatch ? tokenMatch[1] : undefined;

  return {
    blobs,
    hasMore: isTruncated,
    cursor: nextCursor,
  };
}

/**
 * List objects in R2
 */
async function listR2(options = {}) {
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY || !R2_SECRET_KEY) {
    throw new Error('R2 credentials not configured');
  }

  const prefix = options.prefix || '';
  const params = new URLSearchParams({
    'list-type': '2',
    prefix: prefix,
  });

  if (options.cursor) {
    params.append('continuation-token', options.cursor);
  }

  const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}?${params.toString()}`);

  // For GET requests without body, use empty string hash
  const emptyHash = crypto.createHash('sha256').update('').digest('hex');

  const opts = {
    host: url.hostname,
    path: url.pathname + url.search,
    method: 'GET',
    headers: {
      'x-amz-content-sha256': emptyHash,
    },
  };

  aws4.sign(opts, {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  });

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: opts.headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`R2 list failed: ${response.status} ${text}`);
  }

  const xml = await response.text();
  return parseListResponse(xml);
}

/**
 * Delete an object from R2
 */
async function delR2(pathname, options = {}) {
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY || !R2_SECRET_KEY) {
    throw new Error('R2 credentials not configured');
  }

  const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}/${pathname}`);

  // For DELETE requests without body, use empty string hash
  const emptyHash = crypto.createHash('sha256').update('').digest('hex');

  const opts = {
    host: url.hostname,
    path: url.pathname,
    method: 'DELETE',
    headers: {
      'x-amz-content-sha256': emptyHash,
    },
  };

  aws4.sign(opts, {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  });

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers: opts.headers,
  });

  // 204 No Content is success for DELETE
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`R2 delete failed: ${response.status} ${text}`);
  }
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
