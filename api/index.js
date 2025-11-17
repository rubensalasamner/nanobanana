// api/index.js
import Busboy from 'busboy';
import { GoogleGenAI } from '@google/genai';
import QRCode from 'qrcode';
import { nanoid } from 'nanoid';
import { put as blobPut, list as blobList, del as blobDel } from '@vercel/blob';
import sharp from 'sharp';

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
};

/** ===== Config / Constants ===== */
const UPLOAD_TARGET = (process.env.UPLOAD_TARGET || 'blob').toLowerCase(); // 'blob' | 'dataurl'
const MAX_UPLOAD_BYTES = 4.3 * 1024 * 1024; // guard for serverless limits
const ONE_HOUR_MS = 60 * 60 * 1000;

/** ===== Logging ===== */
function log(reqId, level, msg, meta = {}) {
  const entry = { ts: new Date().toISOString(), reqId, level, msg, ...meta };
  (console[level] || console.log)(JSON.stringify(entry));
}

/** ===== Helpers ===== */
function parseMultipart(req, reqId) {
  return new Promise((resolve, reject) => {
    try {
      const bb = Busboy({ headers: req.headers, limits: { fileSize: 15 * 1024 * 1024 } });
      const fields = {};
      let fileBuf = null,
        fileMime = null,
        fileField = null,
        fileName = null,
        fileSize = 0;

      bb.on('file', (name, stream, info) => {
        fileField = name;
        fileName = info.filename || 'upload.jpg';
        fileMime = info.mimeType || 'image/jpeg';
        const chunks = [];
        stream.on('data', (c) => {
          chunks.push(c);
          fileSize += c.length;
        });
        stream.on('limit', () =>
          reject(Object.assign(new Error('File too large'), { status: 413 }))
        );
        stream.on('end', () => {
          fileBuf = Buffer.concat(chunks);
        });
      });

      bb.on('field', (name, val) => {
        fields[name] = val;
      });
      bb.on('error', (e) => reject(e));
      bb.on('finish', () => {
        log(reqId, 'log', 'multipart.parsed', { fields, fileMime, fileField, fileName, fileSize });
        resolve({ fields, fileBuf, fileMime, fileName, fileSize });
      });

      req.pipe(bb);
    } catch (e) {
      reject(e);
    }
  });
}

function extFromMime(m) {
  if (m === 'image/webp') return 'webp';
  if (m === 'image/png') return 'png';
  return 'jpg';
}

function extractFirstImage(resp) {
  const candidates = resp?.candidates || [];
  for (const c of candidates) {
    const parts = c?.content?.parts || [];
    for (const p of parts) {
      if (p?.inlineData?.data) {
        const mime = p.inlineData.mimeType || 'image/png';
        const buf = Buffer.from(p.inlineData.data, 'base64');
        return { mime, buf };
      }
    }
  }
  return null;
}

function getPathnameFromUrl(u) {
  try {
    return new URL(u).pathname.slice(1); // drop leading /
  } catch {
    return null;
  }
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

/** ===== Route handlers ===== */
async function handleHealthz(_req, res) {
  res.status(200).json({ ok: true });
}

async function handleDiag(_req, res) {
  res.status(200).json({
    ok: true,
    hasKey: Boolean(process.env.GEMINI_API_KEY),
    uploadTarget: UPLOAD_TARGET,
    model: 'gemini-2.5-flash-image',
  });
}

async function runGeminiEdit(fileMime, fileBuf, prompt) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const resp = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [
      { text: prompt },
      { inlineData: { mimeType: fileMime || 'image/jpeg', data: fileBuf.toString('base64') } },
    ],
  });
  return extractFirstImage(resp);
}

async function handleEdit(req, res, reqId) {
  const { fields, fileBuf, fileMime, fileSize } = await parseMultipart(req, reqId);
  if (!fileBuf) return res.status(400).json({ error: "No image uploaded (field 'image')" });
  if (fileSize > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'Image too large' });

  const prompt = String(fields.prompt ?? '');
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  log(reqId, 'log', 'gemini.request', {
    model: 'gemini-2.5-flash-image',
    mime: fileMime,
    size: fileSize,
  });
  const outImg = await runGeminiEdit(fileMime, fileBuf, prompt);
  if (!outImg) return res.status(422).json({ error: 'Model returned no image' });

  log(reqId, 'log', 'gemini.ok', { outMime: outImg.mime, outBytes: outImg.buf.length });
  res.setHeader('Content-Type', outImg.mime.startsWith('image/') ? outImg.mime : 'image/png');
  res.status(200).send(outImg.buf);
}

async function handleEditAndShare(req, res, reqId) {
  const { fields, fileBuf, fileMime, fileSize } = await parseMultipart(req, reqId);
  if (!fileBuf) return res.status(400).json({ error: "No image uploaded (field 'image')" });
  if (fileSize > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'Image too large' });

  const prompt = String(fields.prompt ?? '');
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  log(reqId, 'log', 'gemini.request', {
    model: 'gemini-2.5-flash-image',
    mime: fileMime,
    size: fileSize,
  });
  const outImg = await runGeminiEdit(fileMime, fileBuf, prompt);
  if (!outImg) return res.status(422).json({ error: 'Model returned no image' });
  log(reqId, 'log', 'gemini.ok', { outMime: outImg.mime, outBytes: outImg.buf.length });

  const id = nanoid(10);
  const origin = getOrigin(req);
  let imageUrl;
  let outMime = outImg.mime;

  if (UPLOAD_TARGET === 'blob') {
    // Convert image buffer to optimized WebP (~80% quality)
    const webpBuf = await sharp(outImg.buf)
      .rotate() // auto-orient if needed
      .toFormat('webp', { quality: 80 })
      .toBuffer();

    const filename = `shares/${id}.webp`;
    const putStart = Date.now();
    const { url } = await blobPut(filename, webpBuf, {
      access: 'public',
      contentType: 'image/webp',
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    log(reqId, 'log', 'blob.put.ok', { filename, ms: Date.now() - putStart, url });
    imageUrl = url;
    outMime = 'image/webp';
  } else {
    // Fallback dev mode: return data URL (not recommended for production sharing)
    const base64 = `data:${outImg.mime};base64,${outImg.buf.toString('base64')}`;
    imageUrl = base64;
    log(reqId, 'log', 'share.dataurl.ok', { length: base64.length });
  }

  const shareUrl = `${origin}/share.html?imageUrl=${encodeURIComponent(imageUrl)}&id=${id}&mime=${encodeURIComponent(
    outMime
  )}`;

  const qrStart = Date.now();
  const qrDataUrl = await QRCode.toDataURL(shareUrl, { margin: 1, scale: 6 });
  log(reqId, 'log', 'qr.ok', { ms: Date.now() - qrStart });

  const path = getPathnameFromUrl(imageUrl);
  res.status(200).json({
    ok: true,
    id,
    mode: UPLOAD_TARGET,
    mime: outMime,
    imageUrl: imageUrl,
    path, // blob pathname, handy for cleanup
    shareUrl,
    qrDataUrl,
  });
}

async function handleCleanup(_req, res, reqId) {
  // Best-effort: delete blobs under /shares older than 1 hour
  try {
    const now = Date.now();
    let removed = 0;
    let cursor;
    do {
      const {
        blobs,
        hasMore,
        cursor: next,
      } = await blobList({
        prefix: 'shares/',
        cursor,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      cursor = hasMore ? next : undefined;

      for (const b of blobs) {
        // Prefer uploadedAt if available; otherwise skip timestamp check
        const uploaded = b.uploadedAt ? new Date(b.uploadedAt).getTime() : null;
        if (uploaded && now - uploaded > ONE_HOUR_MS) {
          await blobDel(b.pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
          removed++;
        }
      }
    } while (cursor);

    log(reqId, 'log', 'cleanup.ok', { removed });
    res.status(200).json({ ok: true, removed });
  } catch (e) {
    log(reqId, 'error', 'cleanup.fail', { message: e?.message });
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

/** ===== Main handler (route switch) ===== */
export default async function handler(req, res) {
  const reqId = nanoid(8);
  log(reqId, 'log', 'request.start', {
    method: req.method,
    url: req.url,
    uploadTarget: UPLOAD_TARGET,
  });

  try {
    // lightweight routes that don't need multipart
    if (req.method === 'GET' && req.url.startsWith('/api/healthz')) return handleHealthz(req, res);
    if (req.method === 'GET' && req.url.startsWith('/api/diag')) return handleDiag(req, res);
    if (req.method === 'GET' && req.url.startsWith('/api/cleanup'))
      return handleCleanup(req, res, reqId);

    if (req.method !== 'POST') {
      log(reqId, 'warn', 'method.notAllowed', { method: req.method });
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!process.env.GEMINI_API_KEY) {
      log(reqId, 'error', 'env.missing.GEMINI_API_KEY');
      return res.status(500).json({ error: 'Server misconfigured (no GEMINI_API_KEY)' });
    }

    if (req.url.startsWith('/api/edit-and-share')) {
      return await handleEditAndShare(req, res, reqId);
    }
    if (req.url.startsWith('/api/edit')) {
      return await handleEdit(req, res, reqId);
    }

    log(reqId, 'warn', 'route.notFound', { url: req.url });
    res.status(404).json({ error: 'Not found' });
  } catch (err) {
    const code = err?.status || 500;
    log(reqId, 'error', 'request.fail', {
      code,
      name: err?.name,
      message: err?.message,
      stack: err?.stack?.split('\n').slice(0, 3).join(' | '),
    });
    res.status(code).json({ error: 'Server error', detail: err?.message || String(err), reqId });
  }
}
