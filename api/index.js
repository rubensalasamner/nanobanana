import Busboy from "busboy";
import { GoogleGenAI } from "@google/genai";
import QRCode from "qrcode";
import { nanoid } from "nanoid";
import { put as blobPut } from "@vercel/blob";

export const config = {
  api: {
    bodyParser: false,      // we handle multipart ourselves
  },
  runtime: "nodejs20.x",    // ensure Node runtime (not edge)
  maxDuration: 30,
};

/** ===== Utilities ===== */
const UPLOAD_TARGET = (process.env.UPLOAD_TARGET || "dataurl").toLowerCase(); // 'blob' | 'dataurl'
const MAX_UPLOAD_BYTES = 4.3 * 1024 * 1024; // guard for serverless limits

function log(reqId, level, msg, meta = {}) {
  const entry = { ts: new Date().toISOString(), reqId, level, msg, ...meta };
  // Use console[level] if available; fallback to log
  const fn = console[level] || console.log;
  fn(JSON.stringify(entry));
}

function parseMultipart(req, reqId) {
  return new Promise((resolve, reject) => {
    try {
      const bb = Busboy({ headers: req.headers, limits: { fileSize: 15 * 1024 * 1024 } });
      const fields = {};
      let fileBuf = null, fileMime = null, fileField = null, fileName = null, fileSize = 0;

      bb.on("file", (name, stream, info) => {
        fileField = name;
        fileName = info.filename || "upload.jpg";
        fileMime = info.mimeType || "image/jpeg";
        const chunks = [];
        stream.on("data", (c) => { chunks.push(c); fileSize += c.length; });
        stream.on("limit", () => reject(Object.assign(new Error("File too large"), { status: 413 })));
        stream.on("end", () => { fileBuf = Buffer.concat(chunks); });
      });

      bb.on("field", (name, val) => { fields[name] = val; });
      bb.on("error", (e) => reject(e));
      bb.on("finish", () => {
        log(reqId, "log", "multipart.parsed", { fields, fileMime, fileField, fileName, fileSize });
        resolve({ fields, fileBuf, fileMime, fileName, fileSize });
      });

      req.pipe(bb);
    } catch (e) { reject(e); }
  });
}

function extFromMime(m) {
  if (m === "image/webp") return "webp";
  if (m === "image/png") return "png";
  return "jpg";
}

function extractFirstImage(resp) {
  const candidates = resp?.candidates || [];
  for (const c of candidates) {
    const parts = c?.content?.parts || [];
    for (const p of parts) {
      if (p?.inlineData?.data) {
        const mime = p.inlineData.mimeType || "image/png";
        const buf = Buffer.from(p.inlineData.data, "base64");
        return { mime, buf };
      }
    }
  }
  return null;
}

/** ===== Handler ===== */
export default async function handler(req, res) {
  const t0 = Date.now();
  const reqId = nanoid(8); // per-request id for logs
  log(reqId, "log", "request.start", { method: req.method, url: req.url, uploadTarget: UPLOAD_TARGET });

  try {
    if (req.method !== "POST") {
      log(reqId, "warn", "method.notAllowed", { method: req.method });
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!process.env.GEMINI_API_KEY) {
      log(reqId, "error", "env.missing.GEMINI_API_KEY");
      return res.status(500).json({ error: "Server misconfigured (no GEMINI_API_KEY)" });
    }

    // 1) Parse multipart
    const { fields, fileBuf, fileMime, fileSize } = await parseMultipart(req, reqId);
    if (!fileBuf) {
      log(reqId, "warn", "upload.missingFile");
      return res.status(400).json({ error: "No image uploaded (multipart field 'image' expected)" });
    }
    if (fileSize > MAX_UPLOAD_BYTES) {
      log(reqId, "warn", "upload.tooLarge", { fileSize, max: MAX_UPLOAD_BYTES });
      return res.status(413).json({ error: "Image too large for serverless. Try a smaller photo." });
    }

    const prompt = String(fields.prompt ?? "");
    if (!prompt) {
      log(reqId, "warn", "prompt.missing");
      return res.status(400).json({ error: "Missing prompt" });
    }

    // 2) Call Gemini
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    log(reqId, "log", "gemini.request", { model: "gemini-2.5-flash-image", mime: fileMime, size: fileSize });

    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [
        { text: prompt },
        { inlineData: { mimeType: fileMime || "image/jpeg", data: fileBuf.toString("base64") } }
      ],
    });

    const outImg = extractFirstImage(resp);
    if (!outImg) {
      const msg = resp?.candidates?.[0]?.content?.parts?.find(p => p?.text)?.text || "Model returned no image.";
      log(reqId, "warn", "gemini.noImage", { msg });
      return res.status(422).json({ error: msg });
    }
    log(reqId, "log", "gemini.ok", { outMime: outImg.mime, outBytes: outImg.buf.length });

    // 3) Share URL + QR
    const id = nanoid(10);
    let imageUrl, shareUrl;

    if (UPLOAD_TARGET === "blob") {
      // Upload to Vercel Blob (public)
      const ext = extFromMime(outImg.mime);
      const filename = `${id}.${ext}`;
      const putStart = Date.now();
      const { url } = await blobPut(filename, outImg.buf, {
        contentType: outImg.mime,
        access: "public",
        addRandomSuffix: false,
      });
      log(reqId, "log", "blob.put.ok", { filename, ms: Date.now() - putStart, url });
      imageUrl = url;
      shareUrl = url; // or your own pretty /share/:id page if you build one
    } else {
      // Simple demo: embed as data URL share page (works, but not ideal for prod)
      const base64 = `data:${outImg.mime};base64,${outImg.buf.toString("base64")}`;
      imageUrl = base64;
      shareUrl = `data:text/html;base64,${Buffer.from(
        `<!doctype html><meta charset="utf-8"><title>Your Photo</title>
         <img style="max-width:100%;height:auto" src="${base64}">`
      ).toString("base64")}`;
      log(reqId, "log", "share.dataurl.ok", { length: shareUrl.length });
    }

    const qrStart = Date.now();
    const qrDataUrl = await QRCode.toDataURL(shareUrl, { margin: 1, scale: 6 });
    log(reqId, "log", "qr.ok", { ms: Date.now() - qrStart });

    const elapsed = Date.now() - t0;
    log(reqId, "log", "request.success", { elapsed });

    // When in dataurl mode, client expects `imageDataUrl`; when in blob mode, `imageUrl`.
    res.status(200).json({
      ok: true,
      id,
      mode: UPLOAD_TARGET,
      mime: outImg.mime,
      imageUrl: UPLOAD_TARGET === "blob" ? imageUrl : undefined,
      imageDataUrl: UPLOAD_TARGET !== "blob" ? imageUrl : undefined,
      shareUrl,
      qrDataUrl,
      reqId,
      elapsedMs: elapsed,
    });
  } catch (err) {
    const code = err?.status || 500;
    log(reqId, "error", "request.fail", {
      code,
      name: err?.name,
      message: err?.message,
      stack: err?.stack?.split("\n").slice(0, 3).join(" | "),
    });
    res.status(code).json({ error: "Server error", detail: err?.message || String(err), reqId });
  }
}
