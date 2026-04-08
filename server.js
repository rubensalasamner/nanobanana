// This file is for local development only. Do not use on Vercel.
// Vercel uses api/index.js as the serverless function.

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

import {
  BOLIDEN_SCENE_LIBRARY,
  COMPANY_IDS,
  resolveCompany as resolveCompanyId,
} from './public/shared/company-scenes.js';

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

// --- directories ---
const PUBLIC_DIR = path.join(__dirname, 'public');
const SHARES_DIR = path.join(PUBLIC_DIR, 'shares');
const DEBUG_DIR = path.join(SHARES_DIR, 'debug');
// Only create directory if it doesn't exist
try {
  fs.mkdirSync(SHARES_DIR, { recursive: true });
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
} catch (e) {
  // Directory might already exist, ignore error
  if (e.code !== 'EEXIST') throw e;
}

// --- config ---
const UPLOAD_TARGET = (process.env.UPLOAD_TARGET || 'filesystem').toLowerCase(); // filesystem | dataurl
const MAX_UPLOAD_BYTES = 4.3 * 1024 * 1024;
const SQUARE_QUALITY_SUFFIX =
  '\n\nRedraw the content from image 1 in a 1:1 square aspect ratio. Adjust image 1 by adding content as needed to fill a perfect square (1:1) format. Make sure no blank areas are left. Generate a high-quality, detailed, sharp focus image suitable for 300dpi printing.';

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

function extFromMime(mime) {
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/png') return 'png';
  return 'jpg';
}

async function loadPublicImageSafe(relativePath) {
  try {
    const imagePath = path.join(PUBLIC_DIR, ...relativePath.split('/'));
    return await fsp.readFile(imagePath);
  } catch (err) {
    console.warn('Scene image missing:', err?.message);
    return null;
  }
}

async function extractFaceCrop(buf) {
  try {
    const metadata = await sharp(buf).metadata();
    const w = metadata.width || 0;
    const h = metadata.height || 0;
    if (w < 64 || h < 64) return null;

    const cropH = Math.round(h * 0.55);
    const cropW = Math.min(w, Math.round(cropH * 0.85));
    const left = Math.round((w - cropW) / 2);

    const cropped = await sharp(buf)
      .extract({ left, top: 0, width: cropW, height: cropH })
      .resize(384, 384, { fit: 'cover' })
      .toFormat('jpeg', { quality: 80 })
      .toBuffer();

    console.log(`Face crop: ${w}x${h} → ${cropW}x${cropH} → 512x512`);
    return { mime: 'image/jpeg', buffer: cropped };
  } catch (err) {
    console.warn('Face crop failed:', err?.message);
    return null;
  }
}

function buildBolidenPrompt(scene, { hasFaceCrop }) {
  const faceCropRef = hasFaceCrop
    ? ' Image 3 is a close-up crop of that same person\'s face for identity reference.'
    : '';

  const prompt = [
    `Image 1 is the background scene — a Boliden "${scene.label}" work environment. Image 2 is a selfie of the person who must be inserted into that scene.${faceCropRef}`,
    'Keep image 1 exactly as-is: do not redraw, regenerate, or alter the background, existing workers, or equipment.',
    'Insert the person from image 2 as a new, full-body worker standing naturally in the scene with correct scale, perspective, and lighting that matches image 1.',
    'The inserted person\'s face must closely resemble the person in image 2 — preserve their eye shape, eye color, nose structure, jawline, and skin tone. However, the face must be fully integrated into the generated body: adapt the face\'s brightness, shadow direction, color temperature, and contrast to match the scene lighting in image 1. The face should look like it belongs in this environment, not pasted on.',
    'The head must be proportionally sized to the body. Use realistic human head-to-body ratio (roughly 1:7). Do not enlarge or shrink the head relative to the torso and limbs.',
    scene.promptHint || '',
    `Dress the inserted person in PPE appropriate for the scene: ${scene.ppeHint}`,
    'The inserted person should be clearly visible, facing the viewer/camera with head and eyes oriented toward the viewer.',
    'Do not replace, edit, swap, or merge any existing face or head already in image 1. No face swap. No head replacement.',
    'No added text, watermarks, or logos.',
    'Produce a single photorealistic output consistent with the industrial safety culture of the scene.',
    SQUARE_QUALITY_SUFFIX.trim(),
  ].filter(Boolean).join(' ');

  const fallbackPrompt = [
    `Image 1 is a selfie of the person.${hasFaceCrop ? ' Image 2 is a close-up crop of that same person\'s face for identity reference.' : ''}`,
    `Place this person into a Boliden "${scene.label}" work environment.`,
    'The person\'s face must closely resemble image 1 — preserve eye shape, eye color, nose structure, jawline, and skin tone. Adapt the face\'s lighting to match the generated scene. The head must be proportionally sized to the body (roughly 1:7 ratio).',
    scene.promptHint || '',
    `Dress the person in PPE appropriate for the scene: ${scene.ppeHint}`,
    'Generate a photorealistic industrial background consistent with the scene context.',
    'No face swap. No head replacement. No text, watermarks, or logos.',
    'Produce a single photorealistic output consistent with the industrial safety culture of the scene.',
    SQUARE_QUALITY_SUFFIX.trim(),
  ].filter(Boolean).join(' ');

  return { prompt, fallbackPrompt };
}

function resolveGenerationStrategy({ company, originalPrompt, sceneId, hasFaceCrop = false }) {
  if (company === COMPANY_IDS.BOLIDEN) {
    const scene = sceneId ? BOLIDEN_SCENE_LIBRARY[sceneId] : null;
    if (scene) {
      const { prompt, fallbackPrompt } = buildBolidenPrompt(scene, { hasFaceCrop });
      return { prompt, fallbackPrompt, scene };
    }
  }
  const prompt = `${originalPrompt}${SQUARE_QUALITY_SUFFIX}`;
  return { prompt, fallbackPrompt: prompt, scene: null };
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
    ts: new Date().toISOString(),
    serverStartedAt: SERVER_STARTED_AT,
    hasKey: Boolean(process.env.GEMINI_API_KEY),
    model: 'gemini-2.5-flash-image',
    uploadTarget: UPLOAD_TARGET,
  });
});

// --- Gemini client ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Load the black 4x6 aspect ratio template image (blackbg.png)
 */
async function load4x6BlackImage() {
  try {
    const imagePath = path.join(PUBLIC_DIR, 'assets', 'images', 'blackbg.png');
    const imageBuffer = await fsp.readFile(imagePath);
    return imageBuffer;
  } catch (err) {
    console.error('Failed to load blackbg.png:', err);
    throw new Error('Failed to load template image');
  }
}

async function runGeminiEdit(fileMime, fileBuf, prompt, referenceImages = []) {
  // Build contents array with prompt and images
  const contents = [{ text: prompt }];

  // Add user's image as image 1
  contents.push({
    inlineData: { mimeType: fileMime || 'image/jpeg', data: fileBuf.toString('base64') },
  });

  // Add reference images (scene/background) if provided
  for (const ref of referenceImages) {
    if (!ref?.buffer) continue;
    contents.push({
      inlineData: { mimeType: ref.mime || 'image/jpeg', data: ref.buffer.toString('base64') },
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

    const clientMode = req.body.mode === 'mobile' ? 'mobile' : 'booth';
    const company = resolveCompanyId(String(req.body.company ?? ''));
    const sceneId = String(req.body.sceneId ?? '').trim() || null;

    const originalPrompt = String(req.body.prompt ?? '');
    if (company !== COMPANY_IDS.BOLIDEN && !originalPrompt) {
      return res.status(400).json({ error: 'Missing prompt' });
    }
    if (company === COMPANY_IDS.BOLIDEN && !sceneId) {
      return res.status(400).json({ error: 'Missing sceneId for boliden' });
    }

    const fileSize = req.file.buffer.length;
    if (fileSize > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'Image too large' });

    const isBoliden = company === COMPANY_IDS.BOLIDEN;
    const faceCrop = isBoliden ? await extractFaceCrop(req.file.buffer) : null;
    const strategy = resolveGenerationStrategy({
      company,
      originalPrompt,
      sceneId,
      hasFaceCrop: Boolean(faceCrop),
    });
    const sceneImageBuffer = strategy.scene
      ? await loadPublicImageSafe(strategy.scene.imagePath)
      : null;
    if (strategy.scene && !sceneImageBuffer) {
      console.warn(`Boliden scene image missing for sceneId=${sceneId}, falling back to default flow`);
    }
    const prompt = sceneImageBuffer ? strategy.prompt : strategy.fallbackPrompt;

    console.log(`Editing (and sharing) image with prompt: "${originalPrompt}"`);

    const useSceneAsBase = Boolean(sceneImageBuffer);
    const primaryMime = useSceneAsBase ? 'image/jpeg' : req.file.mimetype;
    const primaryBuffer = useSceneAsBase ? sceneImageBuffer : req.file.buffer;
    const secondaryImages = useSceneAsBase
      ? [{ mime: req.file.mimetype || 'image/jpeg', buffer: req.file.buffer }]
      : [];
    if (faceCrop) secondaryImages.push(faceCrop);
    const img = await runGeminiEdit(primaryMime, primaryBuffer, prompt, secondaryImages);
    if (!img) {
      console.warn('No image returned by Gemini');
      return res.status(422).json({ error: 'Model returned no image' });
    }

    const id = nanoid(10);
    const origin = getOrigin(req);
    const rawExt = extFromMime(img.mime);
    const rawFilename = `${id}-gemini-raw.${rawExt}`;
    const rawFilePath = path.join(DEBUG_DIR, rawFilename);
    await fsp.writeFile(rawFilePath, img.buffer);
    const rawStoredPath = `shares/debug/${rawFilename}`;
    const rawImageUrl = `${origin}/${rawStoredPath}`;
    console.log(`Saved raw Gemini output to ${rawStoredPath}`);

    let imageUrl;
    let outMime = img.mime;
    let outBuffer = img.buffer;
    let storedPath = null;

    if (UPLOAD_TARGET === 'dataurl') {
      imageUrl = `data:${outMime};base64,${outBuffer.toString('base64')}`;
      console.log('Returning data URL image (UPLOAD_TARGET=dataurl)');
    } else {
      let ext = extFromMime(outMime);

      if (clientMode !== 'mobile') {
        // Booth flow: normalize to print-ready 1800x1800 WebP.
        const metadata = await sharp(outBuffer).metadata();
        console.log(`Resizing image from ${metadata.width}x${metadata.height} to 1800x1800`);

        const webpBuffer = await sharp(outBuffer)
          .rotate()
          .resize(1800, 1800, {
            fit: 'fill',
            withoutEnlargement: false,
          })
          .toFormat('webp', { quality: 95 })
          .toBuffer();

        const outputMetadata = await sharp(webpBuffer).metadata();
        console.log(`Resized image to ${outputMetadata.width}x${outputMetadata.height}`);
        outBuffer = webpBuffer;
        outMime = 'image/webp';
        ext = 'webp';
      } else {
        console.log(
          `Skipping resize in mobile mode; preserving generated ${outMime} (${outBuffer.length} bytes)`
        );
      }

      const filename = `${id}.${ext}`;
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
      clientMode,
      company,
      sceneId,
      mime: outMime,
      imageUrl,
      path: resolvedPath,
      debugRawImageUrl: rawImageUrl,
      debugRawPath: rawStoredPath,
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
