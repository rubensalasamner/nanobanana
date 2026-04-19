// This file is for local development only. Do not use on Vercel.
// Vercel uses api/index.js as the serverless function.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';

import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import { nanoid } from 'nanoid';

import {
  cleanupLocalShareFiles,
  extFromMime,
  getOrigin,
  handleShareDownload,
  runEditAndSharePipeline,
  runEditCore,
} from './api/requestHandlers.js';

// Exit early if running on Vercel (should not happen, but safety check)
if (process.env.VERCEL) {
  console.warn('server.js should not be executed on Vercel. Use api/index.js instead.');
  process.exit(0);
}

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_STARTED_AT = new Date().toISOString();

const app = express();
app.set('trust proxy', true);

const PUBLIC_DIR = path.join(__dirname, 'public');
const SHARES_DIR = path.join(PUBLIC_DIR, 'shares');
const DEBUG_DIR = path.join(SHARES_DIR, 'debug');
try {
  fs.mkdirSync(SHARES_DIR, { recursive: true });
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
} catch (e) {
  if (e.code !== 'EEXIST') throw e;
}

const UPLOAD_TARGET = (process.env.UPLOAD_TARGET || 'filesystem').toLowerCase(); // filesystem | dataurl

function log(reqId, level, msg, meta = {}) {
  const entry = { ts: new Date().toISOString(), reqId, level, msg, ...meta };
  (console[level] || console.log)(JSON.stringify(entry));
}

function findExistingSharePath(id) {
  for (const ext of ['webp', 'jpg', 'png']) {
    const p = path.join(SHARES_DIR, `${id}.${ext}`);
    if (fs.existsSync(p)) return { path: p, ext };
  }
  return null;
}

async function readLocalShare(req, src) {
  const u = new URL(src);
  const origin = getOrigin(req);
  if (u.origin !== origin || !u.pathname.startsWith('/shares/')) return null;
  const rel = path.normalize(u.pathname.slice(1)).replace(/^(\.\.(\/|\\|$))+/, '');
  if (!rel.startsWith('shares/')) return null;
  const filePath = path.join(PUBLIC_DIR, ...rel.split('/'));
  if (!filePath.startsWith(SHARES_DIR)) return null;
  const buffer = await fsp.readFile(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const contentType =
    ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg';
  const filename = path.basename(filePath);
  return { buffer, contentType, filename };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Only image uploads are allowed'));
    cb(null, true);
  },
});

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(
  express.static(PUBLIC_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  })
);

app.use(
  '/shares',
  express.static(SHARES_DIR, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=604800, immutable'),
  })
);

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/diag', (_req, res) => {
  const explicitDeployStamp =
    process.env.NANOBANANA_DEPLOY_STAMP || process.env.DEPLOY_STAMP || process.env.DEPLOYED_AT || null;

  res.json({
    ok: true,
    ts: new Date().toISOString(),
    serverStartedAt: SERVER_STARTED_AT,
    deployStamp: explicitDeployStamp || SERVER_STARTED_AT,
    hasKey: Boolean(process.env.GEMINI_API_KEY),
    model: 'gemini-2.5-flash-image',
    uploadTarget: UPLOAD_TARGET,
  });
});

app.get('/api/share-download', (req, res) => {
  const reqId = nanoid(8);
  return handleShareDownload(req, res, { reqId, log, readLocalShare });
});

app.post('/api/edit', upload.single('image'), async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
    }
    const reqId = nanoid(8);
    const result = await runEditCore({
      fields: req.body,
      fileBuf: req.file?.buffer,
      fileMime: req.file?.mimetype,
      fileSize: req.file?.buffer?.length ?? 0,
      geminiApiKey: process.env.GEMINI_API_KEY,
      reqId,
      log,
    });
    if (!result.ok) return res.status(result.status).json(result.body);
    res
      .set(
        'Content-Type',
        result.image.mime.startsWith('image/') ? result.image.mime : 'image/png'
      )
      .send(result.image.buf);
  } catch (err) {
    console.error('Gemini request failed:', err);
    res.status(500).json({ error: 'Gemini request failed', detail: String(err?.message || err) });
  }
});

app.post('/api/edit-and-share', upload.single('image'), async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
    }
    const reqId = nanoid(8);
    const result = await runEditAndSharePipeline({
      req,
      reqId,
      log,
      fields: req.body,
      fileBuf: req.file?.buffer,
      fileMime: req.file?.mimetype,
      fileSize: req.file?.buffer?.length ?? 0,
      publicDir: PUBLIC_DIR,
      uploadTarget: UPLOAD_TARGET === 'dataurl' ? 'dataurl' : 'filesystem',
      geminiApiKey: process.env.GEMINI_API_KEY,
      sharesDir: SHARES_DIR,
      pathJoin: path.join,
      afterGemini: async ({ outImg, id, origin }) => {
        const rawExt = extFromMime(outImg.mime);
        const rawFilename = `${id}-gemini-raw.${rawExt}`;
        const rawFilePath = path.join(DEBUG_DIR, rawFilename);
        await fsp.writeFile(rawFilePath, outImg.buf);
        const rawStoredPath = `shares/debug/${rawFilename}`;
        return {
          debugRawImageUrl: `${origin}/${rawStoredPath}`,
          debugRawPath: rawStoredPath,
        };
      },
    });
    if (!result.ok) return res.status(result.status).json(result.body);
    res.json(result.json);
  } catch (err) {
    console.error('edit-and-share failed:', err);
    res.status(500).json({ error: 'Gemini request failed', detail: String(err?.message || err) });
  }
});

app.get('/share/:id', async (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
  const found = findExistingSharePath(id);
  if (!found) return res.status(404).send('Not found');

  const origin = getOrigin(req);
  const imageUrl = `${origin}/shares/${id}.${found.ext}`;

  res.set('Cache-Control', 'no-store').send(`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Your Photo</title>
  <meta property="og:title" content="Your Photo"/>
  <meta property="og:type" content="website"/>
  <meta property="og:image" content="${imageUrl}"/>
  <meta property="og:url" content="${origin}/share/${id}"/>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial;margin:0;padding:24px;display:flex;flex-direction:column;gap:16px;align-items:center}
    img{max-width:min(100%,720px);height:auto;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.15)}
    .row{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
    a.button{padding:12px 16px;border:1px solid #ccc;border-radius:999px;text-decoration:none;color:#111}
  </style>
</head>
<body>
  <h1>🎉 Thanks for visiting the booth!</h1>
  <img src="${imageUrl}" alt="Edited photo"/>
  <div class="row">
    <a class="button" download="booth.${found.ext}" href="${imageUrl}">⬇️ Download</a>
    <a class="button" href="https://wa.me/?text=${encodeURIComponent(imageUrl)}" target="_blank" rel="noopener">🟢 WhatsApp</a>
    <a class="button" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(imageUrl)}" target="_blank" rel="noopener">📘 Facebook</a>
    <a class="button" href="https://x.com/intent/tweet?text=${encodeURIComponent('Snapped at the convention!')}&url=${encodeURIComponent(imageUrl)}" target="_blank" rel="noopener">𝕏 Tweet</a>
    <a class="button" href="sms:?&body=${encodeURIComponent('My booth photo: ' + imageUrl)}">📱 SMS</a>
  </div>
</body>
</html>
  `);
});

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
setInterval(
  async () => {
    try {
      await cleanupLocalShareFiles(SHARES_DIR, { maxAgeMs: MAX_AGE_MS });
    } catch (e) {
      console.warn('Cleanup error:', e.message);
    }
  },
  60 * 60 * 1000
);

app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Kiosk running at http://localhost:${port}`);
  console.log(`Has GEMINI_API_KEY: ${Boolean(process.env.GEMINI_API_KEY)}`);
});
