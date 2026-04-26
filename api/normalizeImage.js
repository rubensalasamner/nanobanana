// Image normalization: apply EXIF orientation to pixels, re-encode to a
// predictable format, and emit before/after diagnostics.
//
// Why: phone uploads routinely arrive with EXIF Orientation != 1 (the
// landscape sensor captured a portrait-held phone; the viewer is expected to
// rotate on display). Browsers, Cursor, OS previews honor that tag — many ML
// pipelines (including InsightFace inside cdingram/face-swap) do not. They see
// a sideways face and silently fail detection. Normalizing once, at the edge
// of the server, guarantees every downstream consumer (Gemini, Replicate,
// sharp crops) sees an upright, consistently-encoded image.
//
// Graceful degradation: if sharp cannot decode the input (e.g. HEIC without
// libheif) or encoding fails, the original buffer is returned and the failure
// is logged. Callers never lose data.

import sharp from 'sharp';

const DEFAULT_JPEG_QUALITY = 95;

/**
 * @typedef {Object} NormalizedImage
 * @property {Buffer|null} buf
 * @property {string|null} mime
 * @property {number|null} width
 * @property {number|null} height
 * @property {boolean} normalized   - true if pixels were actually rotated/re-encoded
 * @property {string|null} reason   - non-null when normalization was skipped or failed
 */

/**
 * Apply EXIF rotation to pixels and re-encode to JPEG. Idempotent — if the
 * input is already an upright JPEG, we still re-encode at high quality to
 * strip EXIF tags and guarantee a clean baseline for downstream consumers.
 *
 * @param {object} args
 * @param {Buffer|null|undefined} args.buf
 * @param {string|null|undefined} args.mime
 * @param {string} [args.reqId]
 * @param {Function} [args.log]
 * @param {string} [args.label]  - prefix for log messages (e.g. "selfie").
 * @param {number} [args.jpegQuality]
 * @returns {Promise<NormalizedImage>}
 */
export async function normalizeImage({
  buf,
  mime,
  reqId,
  log,
  label = 'image',
  jpegQuality = DEFAULT_JPEG_QUALITY,
}) {
  if (!buf || buf.length === 0) {
    return {
      buf: null,
      mime: null,
      width: null,
      height: null,
      normalized: false,
      reason: 'empty-input',
    };
  }

  let before;
  try {
    before = await sharp(buf).metadata();
  } catch (err) {
    log?.(reqId, 'warn', `${label}.normalize.readFailed`, {
      mime: mime ?? null,
      bytes: buf.length,
      message: err?.message,
    });
    return {
      buf,
      mime: mime ?? null,
      width: null,
      height: null,
      normalized: false,
      reason: 'decode-failed',
    };
  }

  log?.(reqId, 'log', `${label}.normalize.before`, {
    mime: mime ?? null,
    bytes: buf.length,
    width: before.width ?? null,
    height: before.height ?? null,
    orientation: before.orientation ?? null,
    format: before.format ?? null,
    hasAlpha: Boolean(before.hasAlpha),
    space: before.space ?? null,
  });

  try {
    const rotatedBuf = await sharp(buf).rotate().jpeg({ quality: jpegQuality }).toBuffer();
    const after = await sharp(rotatedBuf).metadata();

    const pixelsRotated = Boolean(before.orientation && before.orientation > 1);
    const reencoded = before.format !== 'jpeg' || pixelsRotated;

    log?.(reqId, 'log', `${label}.normalize.after`, {
      mime: 'image/jpeg',
      bytes: rotatedBuf.length,
      width: after.width ?? null,
      height: after.height ?? null,
      orientation: after.orientation ?? null,
      format: after.format ?? null,
      pixelsRotated,
      reencoded,
    });

    return {
      buf: rotatedBuf,
      mime: 'image/jpeg',
      width: after.width ?? null,
      height: after.height ?? null,
      normalized: true,
      reason: null,
    };
  } catch (err) {
    log?.(reqId, 'warn', `${label}.normalize.encodeFailed`, {
      message: err?.message,
    });
    return {
      buf,
      mime: mime ?? null,
      width: before.width ?? null,
      height: before.height ?? null,
      normalized: false,
      reason: 'encode-failed',
    };
  }
}
