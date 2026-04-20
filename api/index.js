// api/index.js
import { join } from 'path';

import Busboy from 'busboy';
import { nanoid } from 'nanoid';

import { put as blobPut, list as blobList, del as blobDel } from './storage.js';
import { isFaceSwapAvailable } from './faceSwap.js';
import {
  isFaceRestoreEnabled,
  resolveCodeformerFidelity,
  resolveFaceRestoreModel,
} from './faceRestore.js';
import {
  handleShareDownload,
  performBlobCleanup,
  runEditCore,
  runEditAndSharePipeline,
} from './requestHandlers.js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

/** ===== Config / Constants ===== */
const SERVER_STARTED_AT = new Date().toISOString();
const UPLOAD_TARGET = (process.env.UPLOAD_TARGET || 'blob').toLowerCase(); // 'blob' | 'dataurl'

/** ===== Logging ===== */
function log(reqId, level, msg, meta = {}) {
  const entry = { ts: new Date().toISOString(), reqId, level, msg, ...meta };
  (console[level] || console.log)(JSON.stringify(entry));
}

/** ===== Multipart (Vercel) ===== */
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
    faceSwap: {
      enabled: isFaceSwapAvailable(),
      model: process.env.REPLICATE_FACE_SWAP_MODEL || 'cdingram/face-swap (pinned)',
    },
    faceRestore: {
      enabled: isFaceRestoreEnabled(),
      model: resolveFaceRestoreModel(),
      fidelity: resolveCodeformerFidelity(),
    },
    vercelDeploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    vercelRegion: process.env.VERCEL_REGION || null,
  });
}

async function handleEdit(req, res, reqId) {
  const { fields, fileBuf, fileMime, fileSize } = await parseMultipart(req, reqId);
  const result = await runEditCore({
    fields,
    fileBuf,
    fileMime,
    fileSize,
    geminiApiKey: process.env.GEMINI_API_KEY,
    reqId,
    log,
  });
  if (!result.ok) return res.status(result.status).json(result.body);
  res.setHeader(
    'Content-Type',
    result.image.mime.startsWith('image/') ? result.image.mime : 'image/png'
  );
  res.status(200).send(result.image.buf);
}

async function handleEditAndShare(req, res, reqId) {
  const { fields, fileBuf, fileMime, fileSize } = await parseMultipart(req, reqId);
  const publicDir = join(process.cwd(), 'public');
  const result = await runEditAndSharePipeline({
    req,
    reqId,
    log,
    fields,
    fileBuf,
    fileMime,
    fileSize,
    publicDir,
    uploadTarget: UPLOAD_TARGET === 'blob' ? 'blob' : 'dataurl',
    geminiApiKey: process.env.GEMINI_API_KEY,
    blobPut,
    blobToken: process.env.BLOB_READ_WRITE_TOKEN,
  });
  if (!result.ok) return res.status(result.status).json(result.body);
  res.status(200).json(result.json);
}

async function handleCleanup(_req, res, reqId) {
  try {
    const { removed } = await performBlobCleanup({
      blobList,
      blobDel,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      reqId,
      log,
    });
    res.status(200).json({ ok: true, removed });
  } catch (e) {
    log(reqId, 'error', 'cleanup.fail', { message: e?.message });
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

export default async function handler(req, res) {
  const reqId = nanoid(8);
  log(reqId, 'log', 'request.start', {
    method: req.method,
    url: req.url,
    uploadTarget: UPLOAD_TARGET,
  });

  try {
    if (req.method === 'GET' && req.url.startsWith('/api/healthz')) return handleHealthz(req, res);
    if (req.method === 'GET' && req.url.startsWith('/api/diag')) return handleDiag(req, res);
    if (req.method === 'GET' && req.url.startsWith('/api/cleanup')) return handleCleanup(req, res, reqId);
    if (req.method === 'GET' && req.url.startsWith('/api/share-download'))
      return handleShareDownload(req, res, { reqId, log, readLocalShare: null });

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
