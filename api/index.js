// api/index.js
import { readFile } from 'fs/promises';
import { join } from 'path';

import { GoogleGenAI } from '@google/genai';
import Busboy from 'busboy';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';
import sharp from 'sharp';

import {
  BOLIDEN_SCENE_LIBRARY,
  COMPANY_IDS,
  resolveCompany as resolveCompanyId,
} from '../public/shared/company-scenes.js';

import { put as blobPut, list as blobList, del as blobDel } from './storage.js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
};

/** ===== Config / Constants ===== */
const SERVER_STARTED_AT = new Date().toISOString();
const UPLOAD_TARGET = (process.env.UPLOAD_TARGET || 'blob').toLowerCase(); // 'blob' | 'dataurl'
const MAX_UPLOAD_BYTES = 4.3 * 1024 * 1024; // guard for serverless limits
const ONE_HOUR_MS = 60 * 60 * 1000;
const SQUARE_QUALITY_SUFFIX =
  '\n\nRedraw the content from image 1 in a 1:1 square aspect ratio. Adjust image 1 by adding content as needed to fill a perfect square (1:1) format. Make sure no blank areas are left. Generate a high-quality, detailed, sharp focus image suitable for 300dpi printing.';

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

async function loadPublicImageSafe(relativePath, reqId) {
  try {
    const imagePath = join(process.cwd(), 'public', ...relativePath.split('/'));
    const imageBuffer = await readFile(imagePath);
    return imageBuffer;
  } catch (err) {
    log(reqId, 'warn', 'scene.image.missing', { relativePath, message: err?.message });
    return null;
  }
}

function buildBolidenPrompt(scene) {
  const prompt = [
    `Image 1: Selfie of a person — this is the identity reference.`,
    `Image 2: Photograph of a Boliden "${scene.label}" work environment.`,
    `Create a professional on-site photograph of the person from image 1 working in the environment from image 2. The result should look like a colleague took this photo of them at work.`,
    scene.promptHint || '',
    `The person is recognizably the same individual as in image 1 — same face shape, hair, eyes, skin tone, and overall appearance. Every part of the person (face, body, clothing) is lit consistently by the scene's own lighting.`,
    `The person is wearing appropriate PPE for this work environment: ${scene.ppeHint}`,
    'Keep existing people and environment from image 2 unchanged. Add the person from image 1 as an additional worker.',
    'Natural, proportional body (head-to-body ratio ~1:7), clearly visible, facing the viewer.',
    'Do not alter or swap any existing faces in image 2. No text, watermarks, or logos.',
    SQUARE_QUALITY_SUFFIX.trim(),
  ].filter(Boolean).join(' ');

  const fallbackPrompt = [
    'Image 1: Selfie of a person — this is the identity reference.',
    `Create a professional on-site photograph of the person from image 1 working in a Boliden "${scene.label}" environment.`,
    scene.promptHint || '',
    'The person is recognizably the same individual as in image 1 — same face shape, hair, eyes, skin tone, and overall appearance. Every part of the person is lit consistently by the environment.',
    `The person is wearing appropriate PPE: ${scene.ppeHint}`,
    'Natural, proportional body (head-to-body ratio ~1:7), clearly visible, facing the viewer.',
    'No text, watermarks, or logos.',
    SQUARE_QUALITY_SUFFIX.trim(),
  ].filter(Boolean).join(' ');

  return { prompt, fallbackPrompt };
}

function resolveGenerationStrategy({ company, originalPrompt, sceneId }) {
  if (company === COMPANY_IDS.BOLIDEN) {
    const scene = sceneId ? BOLIDEN_SCENE_LIBRARY[sceneId] : null;
    if (scene) {
      const { prompt, fallbackPrompt } = buildBolidenPrompt(scene);
      return { prompt, fallbackPrompt, scene };
    }
  }

  const prompt = `${originalPrompt}${SQUARE_QUALITY_SUFFIX}`;
  return { prompt, fallbackPrompt: prompt, scene: null };
}

/** ===== Route handlers ===== */
async function handleHealthz(_req, res) {
  res.status(200).json({ ok: true });
}

async function handleDiag(_req, res) {
  const explicitDeployStamp =
    process.env.NANOBANANA_DEPLOY_STAMP || process.env.DEPLOY_STAMP || process.env.DEPLOYED_AT || null;

  res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
    serverStartedAt: SERVER_STARTED_AT,
    deployStamp: explicitDeployStamp || SERVER_STARTED_AT,
    hasKey: Boolean(process.env.GEMINI_API_KEY),
    uploadTarget: UPLOAD_TARGET,
    model: 'gemini-2.5-flash-image',
    vercelDeploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    vercelRegion: process.env.VERCEL_REGION || null,
  });
}

async function runGeminiEdit(fileMime, fileBuf, prompt, reqId, referenceImages = []) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Build contents array with prompt and images
    const contents = [{ text: prompt }];

    // Add user's image as image 1
    contents.push({
      inlineData: { mimeType: fileMime || 'image/jpeg', data: fileBuf.toString('base64') },
    });

    for (const ref of referenceImages) {
      if (!ref?.buf) continue;
      contents.push({
        inlineData: { mimeType: ref.mime || 'image/jpeg', data: ref.buf.toString('base64') },
      });
    }

    const resp = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents,
      config: {
        temperature: 0.2,
        seed: 42,
        imageConfig: {
          aspectRatio: '1:1', // Square (1:1) ratio
        },
      },
    });
    const result = extractFirstImage(resp);
    if (!result && resp) {
      // Log the response to see what we got instead of an image
      log(reqId, 'warn', 'gemini.noImage', {
        prompt: prompt.substring(0, 100),
        candidates: resp?.candidates?.length || 0,
        response: JSON.stringify(resp).substring(0, 500),
      });
    }
    return result;
  } catch (err) {
    log(reqId, 'error', 'gemini.error', {
      message: err?.message,
      prompt: prompt.substring(0, 100),
    });
    throw err;
  }
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
    promptLength: prompt.length,
  });
  const outImg = await runGeminiEdit(fileMime, fileBuf, prompt, reqId);
  if (!outImg) {
    log(reqId, 'error', 'gemini.noImage', { prompt: prompt.substring(0, 100) });
    return res.status(422).json({
      error: 'Model returned no image. The prompt may not be suitable for image generation.',
    });
  }

  log(reqId, 'log', 'gemini.ok', { outMime: outImg.mime, outBytes: outImg.buf.length });
  res.setHeader('Content-Type', outImg.mime.startsWith('image/') ? outImg.mime : 'image/png');
  res.status(200).send(outImg.buf);
}

async function handleEditAndShare(req, res, reqId) {
  const { fields, fileBuf, fileMime, fileSize } = await parseMultipart(req, reqId);
  if (!fileBuf) return res.status(400).json({ error: "No image uploaded (field 'image')" });
  if (fileSize > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'Image too large' });
  const clientMode = fields.mode === 'mobile' ? 'mobile' : 'booth';
  const company = resolveCompanyId(String(fields.company ?? ''));
  const sceneId = String(fields.sceneId ?? '').trim() || null;

  const originalPrompt = String(fields.prompt ?? '');
  if (company !== COMPANY_IDS.BOLIDEN && !originalPrompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }
  if (company === COMPANY_IDS.BOLIDEN && !sceneId) {
    return res.status(400).json({ error: 'Missing sceneId for boliden' });
  }
  const strategy = resolveGenerationStrategy({ company, originalPrompt, sceneId });
  const sceneImageBuf = strategy.scene
    ? await loadPublicImageSafe(strategy.scene.imagePath, reqId)
    : null;
  if (strategy.scene && !sceneImageBuf) {
    log(reqId, 'warn', 'scene.image.fallback', { company, sceneId });
  }
  const prompt = sceneImageBuf ? strategy.prompt : strategy.fallbackPrompt;

  log(reqId, 'log', 'gemini.request', {
    model: 'gemini-2.5-flash-image',
    mime: fileMime,
    size: fileSize,
    promptLength: prompt.length,
    hasTemplate: Boolean(sceneImageBuf),
    clientMode,
    company,
    sceneId,
  });
  const secondaryImages = sceneImageBuf
    ? [{ mime: 'image/jpeg', buf: sceneImageBuf }]
    : [];
  const outImg = await runGeminiEdit(fileMime, fileBuf, prompt, reqId, secondaryImages);
  if (!outImg) {
    log(reqId, 'error', 'gemini.noImage', { prompt: prompt.substring(0, 100) });
    return res.status(422).json({
      error: 'Model returned no image. The prompt may not be suitable for image generation.',
    });
  }
  log(reqId, 'log', 'gemini.ok', { outMime: outImg.mime, outBytes: outImg.buf.length });

  const id = nanoid(10);
  const origin = getOrigin(req);
  let imageUrl;
  let outMime = outImg.mime;

  if (UPLOAD_TARGET === 'blob') {
    let uploadBuf = outImg.buf;
    let contentType = outImg.mime;
    let ext = extFromMime(outImg.mime);

    if (clientMode !== 'mobile') {
      // Booth flow: normalize to print-ready 1800x1800 WebP.
      const metadata = await sharp(outImg.buf).metadata();
      log(reqId, 'log', 'resize.input', { width: metadata.width, height: metadata.height });

      const webpBuf = await sharp(outImg.buf)
        .rotate()
        .resize(1800, 1800, {
          fit: 'fill',
          withoutEnlargement: false,
        })
        .toFormat('webp', { quality: 95 })
        .toBuffer();

      const outputMetadata = await sharp(webpBuf).metadata();
      log(reqId, 'log', 'resize.output', {
        width: outputMetadata.width,
        height: outputMetadata.height,
      });

      uploadBuf = webpBuf;
      contentType = 'image/webp';
      ext = 'webp';
      outMime = 'image/webp';
    } else {
      // Mobile flow: preserve generated image size and format.
      outMime = outImg.mime;
      log(reqId, 'log', 'resize.skip.mobile', { mime: outImg.mime, bytes: outImg.buf.length });
    }

    const filename = `shares/${id}.${ext}`;
    const putStart = Date.now();
    const { url } = await blobPut(filename, uploadBuf, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    log(reqId, 'log', 'blob.put.ok', { filename, ms: Date.now() - putStart, url });
    imageUrl = url;
  } else {
    // Fallback dev mode: return data URL (not recommended for production sharing)
    const base64 = `data:${outImg.mime};base64,${outImg.buf.toString('base64')}`;
    imageUrl = base64;
    log(reqId, 'log', 'share.dataurl.ok', { length: base64.length });
  }

  const shareUrl = `${origin}/share.html?imageUrl=${encodeURIComponent(imageUrl)}&id=${id}&mime=${encodeURIComponent(
    outMime
  )}`;

  let qrDataUrl = null;
  if (clientMode !== 'mobile') {
    const qrStart = Date.now();
    qrDataUrl = await QRCode.toDataURL(shareUrl, { margin: 1, scale: 6 });
    log(reqId, 'log', 'qr.ok', { ms: Date.now() - qrStart });
  } else {
    log(reqId, 'log', 'qr.skip', { reason: 'mobile-mode' });
  }

  const path = getPathnameFromUrl(imageUrl);
  res.status(200).json({
    ok: true,
    id,
    mode: UPLOAD_TARGET,
    clientMode,
    company,
    sceneId,
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
