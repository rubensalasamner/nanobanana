// Shared HTTP-style handlers and pipeline logic for api/index.js (Vercel) and server.js (local).
//
// Responsibilities left in this file:
//   - Input parsing, validation, and size checks
//   - Scene resolution, aspect preset resolution, personBrief derivation
//   - Strategy selection + execution (delegated to ./strategies)
//   - Post-generation image prep (sharp resize/trim), upload (blob/filesystem/dataurl), QR
//
// Generation specifics (Gemini calls, face swap, prompt construction) live in
// ./geminiClient.js, ./faceSwap.js, ./strategies/*.js, and
// ../public/shared/boliden/*.js respectively.

import { readFile, readdir, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';

import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';
import sharp from 'sharp';

import {
  BOLIDEN_SCENE_LIBRARY,
  COMPANY_IDS,
  resolveCompany as resolveCompanyId,
} from '../public/shared/company-scenes.js';
import {
  getOutputAspectPreset,
  resolveOutputAspectId,
} from '../public/shared/output-aspect.js';
import { describePersonAppearance } from '../public/shared/boliden/identity.js';

import { runGeminiEdit } from './geminiClient.js';
import { normalizeImage } from './normalizeImage.js';
import { runStrategyWithFallback, selectStrategy } from './strategies/index.js';
import { NO_FACE_FOUND_MESSAGE } from './strategies/types.js';

export const MAX_UPLOAD_BYTES = 4.3 * 1024 * 1024;
export const ONE_HOUR_MS = 60 * 60 * 1000;

export function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

export function getPathnameFromUrl(u) {
  try {
    return new URL(u).pathname.slice(1);
  } catch {
    return null;
  }
}

export function isAllowedShareDownloadSrc(src, req) {
  let u;
  try {
    u = new URL(src);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;

  let reqHost;
  try {
    reqHost = new URL(getOrigin(req)).hostname;
  } catch {
    return false;
  }

  if (u.hostname === reqHost) {
    return u.pathname.startsWith('/shares/') && !u.pathname.includes('..');
  }
  if (u.hostname.endsWith('.public.blob.vercel-storage.com')) return true;
  const r2 = process.env.R2_PUBLIC_URL;
  if (r2) {
    try {
      if (new URL(r2).hostname === u.hostname) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export function extFromMime(m) {
  if (m === 'image/webp') return 'webp';
  if (m === 'image/png') return 'png';
  return 'jpg';
}

export function getQueryParam(req, name) {
  const q = req.query?.[name];
  if (typeof q === 'string' && q) return q;
  try {
    return new URL(req.url, 'http://localhost').searchParams.get(name);
  } catch {
    return null;
  }
}

export async function loadPublicImageSafe(publicDir, relativePath, log) {
  const tryRead = async (rp) => {
    const imagePath = join(publicDir, ...rp.split('/'));
    return await readFile(imagePath);
  };

  try {
    return await tryRead(relativePath);
  } catch (err) {
    log?.('warn', 'scene.image.missing', { relativePath, message: err?.message });
  }

  // Back-compat / resilience: Boliden scene assets were moved under
  // assets/images/boliden/prompt-backgrounds/. If callers still provide the old
  // path, fall back automatically so both Vercel (/api) and local server don't
  // break on folder reshuffles.
  if (relativePath?.startsWith('assets/images/boliden/') && !relativePath.includes('/prompt-backgrounds/')) {
    const filename = relativePath.slice('assets/images/boliden/'.length);
    const fallback = `assets/images/boliden/prompt-backgrounds/${filename}`;
    try {
      const buf = await tryRead(fallback);
      log?.('log', 'scene.image.fallbackPath', { from: relativePath, to: fallback });
      return buf;
    } catch (err2) {
      log?.('warn', 'scene.image.missing', { relativePath: fallback, message: err2?.message });
    }
  }

  return null;
}

/**
 * Wraps the Gemini identity-description call. Returns the structured result
 * (`{ brief, faceDetected, raw }`) so callers can both consume the brief AND
 * branch on the face-presence flag without paying for a second Gemini call.
 *
 * @returns {Promise<import('../public/shared/boliden/identity.js').DescribeResult>}
 */
export async function describePersonBrief(fileMime, fileBuf, reqId, log, apiKey) {
  const ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY });
  return describePersonAppearance({
    ai,
    fileMime,
    fileBuf,
    onSuccess: (parsed) =>
      log(reqId, 'log', 'describe.ok', {
        descriptionLength: parsed.brief?.length ?? 0,
        faceDetected: parsed.faceDetected,
      }),
    onEmpty: () => log(reqId, 'warn', 'describe.empty'),
    onError: (err) => log(reqId, 'warn', 'describe.failed', { error: String(err?.message || err) }),
  });
}

export async function prepareShareImageForUpload({
  outImg,
  clientMode,
  aspectPreset,
  reqId,
  log,
}) {
  let uploadBuf = outImg.buf;
  let contentType = outImg.mime;
  let ext = extFromMime(outImg.mime);
  let outMime = outImg.mime;

  if (clientMode !== 'mobile') {
    const metadata = await sharp(outImg.buf).metadata();
    log(reqId, 'log', 'resize.input', { width: metadata.width, height: metadata.height });

    let preResize = await sharp(outImg.buf).rotate().toBuffer();
    try {
      const trimmed = await sharp(preResize).trim({ threshold: 32 }).toBuffer();
      const tm = await sharp(trimmed).metadata();
      if (tm.width >= 64 && tm.height >= 64) {
        preResize = trimmed;
        log(reqId, 'log', 'gemini.trim', { w: tm.width, h: tm.height });
      }
    } catch {
      /* uniform border trim not applicable */
    }

    const jpegBuf = await sharp(preResize)
      .resize(aspectPreset.exportWidth, aspectPreset.exportHeight, {
        fit: 'cover',
        position: 'centre',
      })
      .jpeg({ quality: 95 })
      .toBuffer();

    const outputMetadata = await sharp(jpegBuf).metadata();
    log(reqId, 'log', 'resize.output', {
      width: outputMetadata.width,
      height: outputMetadata.height,
    });

    uploadBuf = jpegBuf;
    contentType = 'image/jpeg';
    ext = 'jpg';
    outMime = 'image/jpeg';
  } else {
    log(reqId, 'log', 'resize.skip.mobile', { mime: outImg.mime, bytes: outImg.buf.length });
  }

  return { uploadBuf, contentType, ext, outMime };
}

export async function buildShareUrlAndQr({ origin, id, imageUrl, outMime, clientMode, reqId, log }) {
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

  return { shareUrl, qrDataUrl };
}

export async function runEditCore({
  fields,
  fileBuf,
  fileMime,
  fileSize,
  geminiApiKey,
  reqId,
  log,
}) {
  if (!fileBuf) {
    return { ok: false, status: 400, body: { error: "No image uploaded (field 'image')" } };
  }
  if (fileSize > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, body: { error: 'Image too large' } };
  }

  const prompt = String(fields.prompt ?? '');
  if (!prompt) {
    return { ok: false, status: 400, body: { error: 'Missing prompt' } };
  }

  log(reqId, 'log', 'gemini.request', {
    model: 'gemini-2.5-flash-image',
    mime: fileMime,
    size: fileSize,
    promptLength: prompt.length,
  });
  const aspectPreset = getOutputAspectPreset(resolveOutputAspectId(fields.aspect));
  const outImg = await runGeminiEdit({
    apiKey: geminiApiKey,
    prompt: `${prompt}${aspectPreset.qualitySuffix || ''}`,
    primaryImage: { mime: fileMime, buf: fileBuf },
    referenceImages: [],
    geminiAspectRatio: aspectPreset.geminiAspectRatio,
    reqId,
    log,
  });
  if (!outImg) {
    log(reqId, 'error', 'gemini.noImage', { prompt: prompt.substring(0, 100) });
    return {
      ok: false,
      status: 422,
      body: {
        error: 'Model returned no image. The prompt may not be suitable for image generation.',
      },
    };
  }

  log(reqId, 'log', 'gemini.ok', { outMime: outImg.mime, outBytes: outImg.buf.length });
  return { ok: true, image: outImg };
}

async function buildStrategyContext({
  fields,
  fileBuf,
  fileMime,
  publicDir,
  geminiApiKey,
  reqId,
  log,
  personBrief,
}) {
  const company = resolveCompanyId(String(fields.company ?? ''));
  const sceneId = String(fields.sceneId ?? '').trim() || null;
  const originalPrompt = String(fields.prompt ?? '');
  const clientMode = fields.mode === 'mobile' ? 'mobile' : 'booth';

  const clientAspectId = resolveOutputAspectId(fields.aspect);
  const scene =
    company === COMPANY_IDS.BOLIDEN && sceneId ? BOLIDEN_SCENE_LIBRARY[sceneId] || null : null;
  const outputAspectId = scene?.nativeAspect
    ? resolveOutputAspectId(scene.nativeAspect)
    : clientAspectId;
  const aspectPreset = getOutputAspectPreset(outputAspectId);
  const aspectOverridden = outputAspectId !== clientAspectId;

  const sceneImageBuf = scene
    ? await loadPublicImageSafe(publicDir, scene.imagePath, (level, msg, meta) =>
        log(reqId, level, msg, meta)
      )
    : null;
  if (scene && !sceneImageBuf) {
    log(reqId, 'warn', 'scene.image.fallback', { company, sceneId });
  }

  const ctx = {
    company,
    sceneId,
    scene,
    clientMode,
    originalPrompt,
    personBrief,
    aspectPreset,
    selfie: { mime: fileMime || 'image/jpeg', buf: fileBuf },
    sceneImage: sceneImageBuf ? { mime: 'image/jpeg', buf: sceneImageBuf } : null,
    geminiApiKey,
    reqId,
    log,
  };

  return { ctx, clientAspectId, aspectOverridden };
}

export async function runEditAndSharePipeline({
  req,
  reqId,
  log,
  fields,
  fileBuf,
  fileMime,
  fileSize,
  publicDir,
  uploadTarget,
  geminiApiKey,
  blobPut,
  blobToken,
  sharesDir,
  pathJoin = join,
  afterGemini,
}) {
  if (!fileBuf) {
    return { ok: false, status: 400, body: { error: "No image uploaded (field 'image')" } };
  }
  if (fileSize > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, body: { error: 'Image too large' } };
  }

  const clientMode = fields.mode === 'mobile' ? 'mobile' : 'booth';
  const company = resolveCompanyId(String(fields.company ?? ''));
  const sceneId = String(fields.sceneId ?? '').trim() || null;
  const originalPrompt = String(fields.prompt ?? '');

  if (company !== COMPANY_IDS.BOLIDEN && !originalPrompt) {
    return { ok: false, status: 400, body: { error: 'Missing prompt' } };
  }
  if (company === COMPANY_IDS.BOLIDEN && !sceneId) {
    return { ok: false, status: 400, body: { error: 'Missing sceneId for boliden' } };
  }

  // Normalize the selfie once, at the edge: apply EXIF rotation to pixels and
  // re-encode to JPEG. Downstream consumers (Gemini describe, Gemini compose,
  // Replicate face-swap, sharp crops) then all see the same upright, tag-free
  // bytes. Phone uploads are the primary reason: many arrive with
  // Orientation != 1 and display correctly in browsers but fail face
  // detection in InsightFace (the backend of cdingram/face-swap).
  const normalized = await normalizeImage({
    buf: fileBuf,
    mime: fileMime,
    reqId,
    log,
    label: 'selfie',
  });
  const normalizedBuf = normalized.buf ?? fileBuf;
  const normalizedMime = normalized.mime ?? fileMime;

  // Describe the selfie up-front for Boliden requests. The same call is the
  // identity brief AND the face-presence pre-check (see identity.js). A clear
  // `faceDetected: false` short-circuits the pipeline with 422 before any
  // strategy runs — saves ~25 s and one Replicate prediction per request
  // that would otherwise hit `no_face_found` deep in the swap step.
  const describeResult =
    company === COMPANY_IDS.BOLIDEN
      ? await describePersonBrief(normalizedMime, normalizedBuf, reqId, log, geminiApiKey)
      : null;

  if (describeResult?.faceDetected === false) {
    log(reqId, 'warn', 'selfie.faceDetect.absent', {
      via: 'describePersonAppearance',
    });
    return {
      ok: false,
      status: 422,
      body: {
        error: NO_FACE_FOUND_MESSAGE,
        reason: 'no_face_found',
        detectedAt: 'pre-check',
        company,
        sceneId,
      },
    };
  }

  const { ctx, clientAspectId, aspectOverridden } = await buildStrategyContext({
    fields,
    fileBuf: normalizedBuf,
    fileMime: normalizedMime,
    publicDir,
    geminiApiKey,
    reqId,
    log,
    personBrief: describeResult?.brief ?? null,
  });

  if (company === COMPANY_IDS.BOLIDEN && sceneId && !ctx.scene) {
    log(reqId, 'error', 'scene.unknown', { sceneId });
    return {
      ok: false,
      status: 400,
      body: {
        error: `Unknown Boliden scene: "${sceneId}". The scene is not registered in BOLIDEN_SCENE_LIBRARY, or the server was started before the scene was added and needs a restart.`,
        company,
        sceneId,
      },
    };
  }
  if (company === COMPANY_IDS.BOLIDEN && ctx.scene && !ctx.sceneImage) {
    log(reqId, 'error', 'scene.image.unavailable', {
      sceneId,
      imagePath: ctx.scene.imagePath,
    });
    return {
      ok: false,
      status: 400,
      body: {
        error: `Scene "${sceneId}" is registered but its image file at "${ctx.scene.imagePath}" could not be read from disk.`,
        company,
        sceneId,
      },
    };
  }

  const chosen = selectStrategy(ctx);
  log(reqId, 'log', 'request.plan', {
    model: 'gemini-2.5-flash-image',
    mime: fileMime,
    size: fileSize,
    clientMode,
    company,
    sceneId,
    primaryFace: ctx.scene?.primaryFace?.strategy ?? null,
    outputAspect: ctx.aspectPreset.id,
    clientAspect: clientAspectId,
    aspectOverridden,
    hasScene: Boolean(ctx.sceneImage),
    strategy: chosen?.name ?? 'none',
  });

  if (!chosen) {
    return {
      ok: false,
      status: 422,
      body: {
        error: `No strategy could handle this request (company="${company}", sceneId="${sceneId ?? ''}"). This is a pipeline configuration bug.`,
        company,
        sceneId,
      },
    };
  }

  const result = await runStrategyWithFallback(ctx);

  if (result?.fatalReason) {
    return {
      ok: false,
      status: 422,
      body: {
        error: result.fatalMessage || 'Generation failed.',
        reason: result.fatalReason,
        company,
        sceneId,
      },
    };
  }

  if (!result?.image) {
    return {
      ok: false,
      status: 422,
      body: {
        error:
          company === COMPANY_IDS.BOLIDEN
            ? `All Boliden strategies failed to produce an image for scene "${sceneId}". Check server logs for gemini.noImage finishReason and faceSwap.fail details.`
            : 'Model returned no image. The prompt may not be suitable for image generation.',
        company,
        sceneId,
      },
    };
  }

  const outImg = result.image;
  log(reqId, 'log', 'gemini.ok', {
    outMime: outImg.mime,
    outBytes: outImg.buf.length,
    strategy: result.strategyName,
  });

  const id = nanoid(10);
  const origin = getOrigin(req);

  const extraFields = afterGemini
    ? await afterGemini({ outImg, id, origin, reqId, log, strategy: result.strategyName })
    : {};

  const aspectPreset = ctx.aspectPreset;
  let imageUrl;
  let outMime = outImg.mime;
  let pathValue;

  if (uploadTarget === 'blob') {
    const prepared = await prepareShareImageForUpload({
      outImg,
      clientMode,
      aspectPreset,
      reqId,
      log,
    });
    const filename = `shares/${id}.${prepared.ext}`;
    const putStart = Date.now();
    const { url } = await blobPut(filename, prepared.uploadBuf, {
      access: 'public',
      contentType: prepared.contentType,
      addRandomSuffix: false,
      token: blobToken,
    });
    log(reqId, 'log', 'blob.put.ok', { filename, ms: Date.now() - putStart, url });
    imageUrl = url;
    outMime = prepared.outMime;
    pathValue = getPathnameFromUrl(imageUrl);
  } else if (uploadTarget === 'dataurl') {
    const base64 = `data:${outImg.mime};base64,${outImg.buf.toString('base64')}`;
    imageUrl = base64;
    outMime = outImg.mime;
    log(reqId, 'log', 'share.dataurl.ok', { length: base64.length });
    pathValue = getPathnameFromUrl(imageUrl);
  } else if (uploadTarget === 'filesystem') {
    if (!sharesDir) {
      return {
        ok: false,
        status: 500,
        body: { error: 'Server misconfigured (sharesDir required for filesystem upload)' },
      };
    }
    const prepared = await prepareShareImageForUpload({
      outImg,
      clientMode,
      aspectPreset,
      reqId,
      log,
    });
    const filename = `${id}.${prepared.ext}`;
    const filePath = pathJoin(sharesDir, filename);
    await writeFile(filePath, prepared.uploadBuf);
    const storedPath = `shares/${filename}`;
    imageUrl = `${origin}/${storedPath}`;
    outMime = prepared.outMime;
    pathValue = storedPath;
  } else {
    return {
      ok: false,
      status: 500,
      body: { error: `Unknown uploadTarget: ${uploadTarget}` },
    };
  }

  const { shareUrl, qrDataUrl } = await buildShareUrlAndQr({
    origin,
    id,
    imageUrl,
    outMime,
    clientMode,
    reqId,
    log,
  });

  return {
    ok: true,
    json: {
      ok: true,
      id,
      mode: uploadTarget,
      clientMode,
      company,
      sceneId,
      mime: outMime,
      imageUrl,
      path: pathValue,
      shareUrl,
      qrDataUrl,
      strategy: result.strategyName,
      ...extraFields,
    },
  };
}

export async function handleShareDownload(req, res, { reqId, log, readLocalShare }) {
  const src = getQueryParam(req, 'src');
  if (!src) return res.status(400).json({ error: 'Missing src' });
  if (!isAllowedShareDownloadSrc(src, req)) {
    log(reqId, 'warn', 'shareDownload.denied', { srcPreview: src.slice(0, 96) });
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    if (readLocalShare) {
      const local = await readLocalShare(req, src);
      if (local) {
        res.setHeader('Content-Type', local.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${local.filename}"`);
        return res.status(200).send(local.buffer);
      }
    }

    const r = await fetch(src, { redirect: 'follow' });
    if (!r.ok) {
      log(reqId, 'warn', 'shareDownload.upstream', { status: r.status });
      return res.status(502).json({ error: 'Upstream error' });
    }
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    let pathname;
    try {
      pathname = new URL(src).pathname;
    } catch {
      pathname = '';
    }
    const fromUrl = pathname.split('/').pop();
    const safeName = (fromUrl && fromUrl.includes('.') ? fromUrl : 'nanobanana-image.jpg').replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );

    res.setHeader('Content-Type', ct.startsWith('image/') ? ct : 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.status(200).send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    log(reqId, 'error', 'shareDownload.fail', { message: e?.message });
    res.status(500).json({ error: 'Download failed' });
  }
}

export async function performBlobCleanup({ blobList, blobDel, token, reqId, log, maxAgeMs = ONE_HOUR_MS }) {
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
      token,
    });
    cursor = hasMore ? next : undefined;

    for (const b of blobs) {
      const uploaded = b.uploadedAt ? new Date(b.uploadedAt).getTime() : null;
      if (uploaded && now - uploaded > maxAgeMs) {
        await blobDel(b.pathname, { token });
        removed++;
      }
    }
  } while (cursor);

  log(reqId, 'log', 'cleanup.ok', { removed });
  return { removed };
}

export async function cleanupLocalShareFiles(sharesDir, { maxAgeMs, filter = /\.(jpg|png|webp)$/i }) {
  const files = await readdir(sharesDir);
  const now = Date.now();
  let removed = 0;
  await Promise.all(
    files.map(async (f) => {
      if (!filter.test(f)) return;
      const p = join(sharesDir, f);
      const st = await stat(p);
      if (now - st.mtimeMs > maxAgeMs) {
        await unlink(p).catch(() => {});
        removed++;
      }
    })
  );
  return { removed };
}
