// api/index.js
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { nanoid } from "nanoid";
import QRCode from "qrcode";
import { put, get, list, del } from "@vercel/blob";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", true);

// ---- helpers ----
function getOrigin(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http");
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}
function extFromMime(m) {
  if (!m) return "jpg";
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  return "jpg";
}

// ---- uploads (keep <= 5 MB) ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error("Only image uploads are allowed"));
    cb(null, true);
  },
});

// ---- basic log ----
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ---- serve /public for local dev preview via vercel dev ----
app.use(
  express.static(path.join(__dirname, "..", "public"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-store");
    },
  })
);

// ---- health/diag ----
app.get("/api/healthz", (_req, res) => res.json({ ok: true }));
app.get("/api/diag", (_req, res) =>
  res.json({ ok: true, hasKey: Boolean(process.env.GEMINI_API_KEY), model: "gemini-2.5-flash-image" })
);

// ---- Gemini ----
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function extractImagePart(resp) {
  const candidates = resp?.candidates || [];
  for (const c of candidates) {
    const parts = c?.content?.parts || [];
    for (const p of parts) {
      if (p?.inlineData?.data) {
        const mime = p.inlineData.mimeType || "image/png";
        const b64 = p.inlineData.data;
        return { mime, buffer: Buffer.from(b64, "base64") };
      }
    }
  }
  return null;
}

// ---- /api/edit (binary) ----
app.post("/api/edit", upload.single("image"), async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const prompt = String(req.body.prompt ?? "");
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const mimeType = req.file.mimetype || "image/jpeg";
    const base64 = req.file.buffer.toString("base64");

    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }],
    });

    const img = extractImagePart(resp);
    if (!img) {
      const parts = resp?.candidates?.[0]?.content?.parts || [];
      const textMsg = parts.find(p => p?.text)?.text || "No image returned by model";
      return res.status(422).json({ error: textMsg });
    }

    res.set("Content-Type", img.mime.startsWith("image/") ? img.mime : "image/png").send(img.buffer);
  } catch (err) {
    console.error("Gemini request failed:", err);
    res.status(500).json({ error: "Gemini request failed", detail: String(err?.message || err) });
  }
});

// ---- /api/edit-and-share (Blob + QR) ----
app.post("/api/edit-and-share", upload.single("image"), async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const prompt = String(req.body.prompt ?? "");
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const mimeType = req.file.mimetype || "image/jpeg";
    const base64 = req.file.buffer.toString("base64");

    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }],
    });

    const img = extractImagePart(resp);
    if (!img) {
      const parts = resp?.candidates?.[0]?.content?.parts || [];
      const textMsg = parts.find(p => p?.text)?.text || "No image returned by model";
      return res.status(422).json({ error: textMsg });
    }

    const id = nanoid(10);
    const ext = extFromMime(img.mime);
    const ts = Date.now();

    // Store the image (public)
    const blob = await put(`shares/${id}.${ext}`, img.buffer, {
      access: "public",
      contentType: img.mime
    });

    // Store tiny metadata the share page + cleanup will use
    const meta = { id, ext, url: blob.url, mime: img.mime, ts };
    await put(`shares/${id}.json`, JSON.stringify(meta), {
      access: "public",
      contentType: "application/json"
    });

    const origin = getOrigin(req);
    const shareUrl = `${origin}/share/${id}`;
    const qrDataUrl = await QRCode.toDataURL(shareUrl, { margin: 1, scale: 6 });

    res.json({ ok: true, id, imageUrl: blob.url, shareUrl, qrDataUrl, mime: img.mime });
  } catch (err) {
    console.error("edit-and-share failed:", err);
    res.status(500).json({ error: "Gemini request failed", detail: String(err?.message || err) });
  }
});

// ---- Share page (reads metadata) ----
app.get("/share/:id", async (req, res) => {
  const id = String(req.params.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!id) return res.status(404).send("Not found");
  try {
    const { blob } = await get(`shares/${id}.json`);
    if (!blob) return res.status(404).send("Not found");
    const meta = JSON.parse(await blob.text());

    const origin = getOrigin(req);
    const imageUrl = meta.url;

    res.set("Cache-Control", "no-store").send(`<!doctype html>
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
    <a class="button" download="booth.${meta.ext}" href="${imageUrl}">⬇️ Download</a>
    <a class="button" href="https://wa.me/?text=${encodeURIComponent(imageUrl)}" target="_blank" rel="noopener">🟢 WhatsApp</a>
    <a class="button" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(imageUrl)}" target="_blank" rel="noopener">📘 Facebook</a>
    <a class="button" href="https://x.com/intent/tweet?text=${encodeURIComponent("Snapped at the expo!")}&url=${encodeURIComponent(imageUrl)}" target="_blank" rel="noopener">𝕏 Tweet</a>
    <a class="button" href="sms:?&body=${encodeURIComponent("My booth photo: " + imageUrl)}">📱 SMS</a>
  </div>
</body>
</html>`);
  } catch (e) {
    console.warn("share page error:", e.message);
    res.status(404).send("Not found");
  }
});

// ---- Cleanup (delete images older than 1 hour) ----
app.get("/api/cleanup", async (_req, res) => {
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  let scanned = 0, removed = 0;

  try {
    // Page through all blobs under /shares
    let cursor = undefined;
    do {
      const { blobs, hasMore, cursor: nextCursor } = await list({ prefix: "shares/", cursor });
      cursor = hasMore ? nextCursor : undefined;

      // Only look at metadata .json files
      for (const b of blobs) {
        if (!b.pathname.endsWith(".json")) continue;
        scanned++;

        try {
          const { blob } = await get(b.pathname);
          const meta = JSON.parse(await blob.text());
          if (now - Number(meta.ts || 0) > ONE_HOUR) {
            // Delete JSON + image
            const imgPath = `shares/${meta.id}.${meta.ext}`;
            await Promise.allSettled([ del(b.pathname), del(imgPath) ]);
            removed++;
          }
        } catch (e) {
          // If JSON is broken, best-effort: try to delete it
          await del(b.pathname).catch(() => {});
        }
      }
    } while (cursor);
    res.json({ ok: true, scanned, removed });
  } catch (e) {
    console.error("cleanup error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default app;
