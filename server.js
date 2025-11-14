import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';

import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';
import sharp from 'sharp';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', true);

// --- directories ---
const PUBLIC_DIR = path.join(__dirname, 'public');
const SHARES_DIR = path.join(PUBLIC_DIR, 'shares');
fs.mkdirSync(SHARES_DIR, { recursive: true });

// --- config ---
const UPLOAD_TARGET = (process.env.UPLOAD_TARGET || 'filesystem').toLowerCase(); // filesystem | dataurl
const MAX_UPLOAD_BYTES = 4.3 * 1024 * 1024;

// --- helpers ---
function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}
function findExistingSharePath(id) {
  for (const ext of ['webp', 'jpg', 'png']) {
    const p = path.join(SHARES_DIR, `${id}.${ext}`);
    if (fs.existsSync(p)) return { path: p, ext };
  }
  return null;
}

function getPathnameFromUrl(u) {
  try {
    return new URL(u).pathname.slice(1);
  } catch {
    return null;
  }
}

// --- uploads ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Only image uploads are allowed'));
    cb(null, true);
  },
});

// --- basic request logger ---
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// --- static files ---
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  })
);

// Serve /shares with strong caching (filenames are content-addressed by id+ext)
app.use(
  '/shares',
  express.static(SHARES_DIR, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=604800, immutable'),
  })
);

// --- health & diagnostics ---
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/diag', (_req, res) => {
  res.json({
    ok: true,
    hasKey: Boolean(process.env.GEMINI_API_KEY),
    model: 'gemini-2.5-flash-image',
    uploadTarget: UPLOAD_TARGET,
  });
});

// --- Gemini client ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function runGeminiEdit(fileMime, fileBuf, prompt) {
  const resp = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [
      { text: prompt },
      { inlineData: { mimeType: fileMime || 'image/jpeg', data: fileBuf.toString('base64') } },
    ],
  });
  return extractImagePart(resp);
}

// --- helper: extract first image from a generateContent response ---
function extractImagePart(resp) {
  const candidates = resp?.candidates || [];
  for (const c of candidates) {
    const parts = c?.content?.parts || [];
    for (const p of parts) {
      if (p?.inlineData?.data) {
        const mime = p.inlineData.mimeType || 'image/png';
        const b64 = p.inlineData.data;
        return { mime, buffer: Buffer.from(b64, 'base64') };
      }
    }
  }
  return null;
}

// --- /api/edit: returns the edited image binary directly ---
app.post('/api/edit', upload.single('image'), async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      console.warn('GEMINI_API_KEY is missing');
      return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
    }
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    const prompt = String(req.body.prompt ?? '');
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const fileSize = req.file.buffer.length;
    if (fileSize > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'Image too large' });

    console.log(`Editing image (${req.file.mimetype}, ${fileSize} bytes) with prompt: "${prompt}"`);

    const img = await runGeminiEdit(req.file.mimetype, req.file.buffer, prompt);
    if (!img) {
      console.warn('No image in response from Gemini');
      return res.status(422).json({ error: 'Model returned no image' });
    }

    res
      .set('Content-Type', img.mime.startsWith('image/') ? img.mime : 'image/png')
      .send(img.buffer);
  } catch (err) {
    console.error('Gemini request failed:', err);
    res.status(500).json({ error: 'Gemini request failed', detail: String(err?.message || err) });
  }
});

// --- /api/edit-and-share: edit, save to /shares, return urls + QR ---
app.post('/api/edit-and-share', upload.single('image'), async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
    }
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    const prompt = String(req.body.prompt ?? '');
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const fileSize = req.file.buffer.length;
    if (fileSize > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'Image too large' });

    console.log(`Editing (and sharing) image with prompt: "${prompt}"`);

    const img = await runGeminiEdit(req.file.mimetype, req.file.buffer, prompt);
    if (!img) {
      console.warn('No image returned by Gemini');
      return res.status(422).json({ error: 'Model returned no image' });
    }

    const id = nanoid(10);
    const origin = getOrigin(req);

    let imageUrl;
    let outMime = img.mime;
    let outBuffer = img.buffer;
    let storedPath = null;

    if (UPLOAD_TARGET === 'dataurl') {
      imageUrl = `data:${outMime};base64,${outBuffer.toString('base64')}`;
      console.log('Returning data URL image (UPLOAD_TARGET=dataurl)');
    } else {
      const webpBuffer = await sharp(outBuffer)
        .rotate()
        .toFormat('webp', { quality: 80 })
        .toBuffer();
      outBuffer = webpBuffer;
      outMime = 'image/webp';
      const filename = `${id}.webp`;
      const filePath = path.join(SHARES_DIR, filename);
      await fsp.writeFile(filePath, outBuffer);
      storedPath = `shares/${filename}`;
      imageUrl = `${origin}/${storedPath}`;
    }

    const shareUrl = `${origin}/share.html?imageUrl=${encodeURIComponent(
      imageUrl
    )}&id=${id}&mime=${encodeURIComponent(outMime)}`;

    const qrDataUrl = await QRCode.toDataURL(shareUrl, { margin: 1, scale: 6 });
    const resolvedPath = storedPath || getPathnameFromUrl(imageUrl);

    res.json({
      ok: true,
      id,
      mode: UPLOAD_TARGET,
      mime: outMime,
      imageUrl,
      path: resolvedPath,
      shareUrl,
      qrDataUrl,
    });
  } catch (err) {
    console.error('edit-and-share failed:', err);
    res.status(500).json({ error: 'Gemini request failed', detail: String(err?.message || err) });
  }
});

// --- public share page ---
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

// --- OPTIONAL: simple cleanup of old files (24h) ---
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
setInterval(
  async () => {
    try {
      const files = await fsp.readdir(SHARES_DIR);
      const now = Date.now();
      await Promise.all(
        files.map(async (f) => {
          if (!/\.(jpg|png|webp)$/i.test(f)) return;
          const p = path.join(SHARES_DIR, f);
          const st = await fsp.stat(p);
          if (now - st.mtimeMs > MAX_AGE_MS) await fsp.unlink(p).catch(() => {});
        })
      );
    } catch (e) {
      console.warn('Cleanup error:', e.message);
    }
  },
  60 * 60 * 1000
); // hourly

// --- SPA fallback LAST ---
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// --- start ---
const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Kiosk running at http://localhost:${port}`);
  console.log(`Has GEMINI_API_KEY: ${Boolean(process.env.GEMINI_API_KEY)}`);
});
