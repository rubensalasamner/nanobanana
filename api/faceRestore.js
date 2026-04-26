// Face restoration wrapper using sczhou/codeformer on Replicate.
//
// Applied after face-swap to add natural skin texture, pore detail, and edge
// blending to the swapped face so it matches surrounding image detail. Targets
// the classic InsightFace inswapper_128 artifact: the swapped face is 128x128
// upscaled and reads as subtly smoother than the Gemini-rendered surroundings.
//
// CodeFormer's codeformer_fidelity parameter (0.0 = max restoration detail,
// 1.0 = max identity preservation) controls the identity/detail trade-off.
// Default 0.7 favors the identity we just fought for in the swap step.
//
// Graceful degradation (same pattern as faceSwap.js): returns null if the
// feature is disabled, the token is missing, the inputs are empty, the call
// times out, or the call errors — so callers can return the pre-restore swap.

import Replicate from 'replicate';

import { compositeIntoRegion, extractCrop, isValidCropRect } from './cropComposite.js';

const DEFAULT_FACE_RESTORE_MODEL =
  'sczhou/codeformer:cc4956dd26fa5a7185d5660cc9100fab1b8070a1d1654a8bb5eb6d443b020bb2';
const DEFAULT_FIDELITY = 0.7;

// Single-request budget. Allows for a cold container spin-up plus inference.
// If a request exceeds this, we degrade to the unrestored swap instead of
// hanging the user's generation. The underlying Replicate run may continue
// in the background (Replicate v1 has no clean abort) and briefly burn
// credits — tracked intentionally as a cost-of-safety.
const RESTORE_TIMEOUT_MS = 90_000;

export function resolveCodeformerFidelity() {
  const raw = process.env.CODEFORMER_FIDELITY;
  if (raw == null || raw === '') return DEFAULT_FIDELITY;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return DEFAULT_FIDELITY;
  return n;
}

export function resolveFaceRestoreModel() {
  return process.env.REPLICATE_FACE_RESTORE_MODEL || DEFAULT_FACE_RESTORE_MODEL;
}

export function isFaceRestoreEnabled() {
  if (!process.env.REPLICATE_API_TOKEN) return false;
  const skip = String(process.env.SKIP_FACE_RESTORE ?? '').toLowerCase();
  if (skip === 'true' || skip === '1' || skip === 'yes') return false;
  const flag = String(process.env.ENABLE_FACE_RESTORE ?? 'true').toLowerCase();
  return flag !== 'false' && flag !== '0' && flag !== 'no';
}

function toDataUri({ mime, buf }) {
  const safeMime = mime || 'image/jpeg';
  return `data:${safeMime};base64,${buf.toString('base64')}`;
}

// Mirrors faceSwap.fetchOutputAsBuffer — Replicate v1 can return a string URL,
// an array of strings, a FileOutput (ReadableStream subclass with .url() /
// .blob()), or an array of those. Normalize all of these to { mime, buf }.
async function fetchOutputAsBuffer(output) {
  const first = Array.isArray(output) ? output[0] : output;
  if (first == null) return null;

  if (typeof first.blob === 'function') {
    const blob = await first.blob();
    const mime = blob.type || 'image/jpeg';
    const buf = Buffer.from(await blob.arrayBuffer());
    return { mime, buf };
  }

  let url = null;
  if (typeof first === 'string') url = first;
  else if (typeof first.url === 'function') {
    const u = first.url();
    url = typeof u === 'string' ? u : u?.toString?.();
  } else if (first.url && typeof first.url.toString === 'function') {
    url = first.url.toString();
  }

  if (!url || typeof url !== 'string') return null;

  const r = await fetch(url);
  if (!r.ok) {
    const err = new Error(`face-restore output fetch failed: HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const mime = r.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await r.arrayBuffer());
  return { mime, buf };
}

function withTimeout(promise, ms, onTimeoutError) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(onTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Run CodeFormer over the input image. When `cropRect` is provided, the
 * restoration is scoped to that region only: we crop the rect, send only the
 * crop to CodeFormer, then composite the restored crop back into the original
 * image with a feathered alpha edge.
 *
 * Why scoped restoration matters: CodeFormer detects every face in its input
 * and restores all of them. In multi-person Boliden scenes that means every
 * existing worker also gets re-rendered, producing visible identity drift
 * (the "manipulating multiple faces" artifact reported on water-samples and
 * meeting-at-the-mill). Passing `cropRect` from the targeted face-swap step
 * confines CodeFormer to the only face we actually changed.
 *
 * Without `cropRect` the function preserves its original full-frame
 * behaviour, which is the correct fallback when the swap was a full-frame
 * swap (no targeted bbox was found).
 *
 * @param {object} args
 * @param {{mime:string,buf:Buffer}} args.image
 * @param {{left:number,top:number,width:number,height:number}|null} [args.cropRect]
 * @param {string} args.reqId
 * @param {Function} args.log
 * @param {string} [args.modelRef]
 * @returns {Promise<{mime:string,buf:Buffer}|null>}
 */
export async function restoreFace({ image, cropRect = null, reqId, log, modelRef }) {
  if (!isFaceRestoreEnabled()) {
    log?.(reqId, 'log', 'faceRestore.skip.disabled');
    return null;
  }
  if (!image?.buf) {
    log?.(reqId, 'warn', 'faceRestore.skip.missingInput');
    return null;
  }

  const scoped = cropRect != null && isValidCropRect(cropRect);
  if (cropRect != null && !scoped) {
    log?.(reqId, 'warn', 'faceRestore.cropRect.invalid', { cropRect });
  }

  let restoreInputImage = image;
  if (scoped) {
    try {
      const cropBuf = await extractCrop({ image, cropRect });
      restoreInputImage = { mime: 'image/png', buf: cropBuf };
    } catch (err) {
      log?.(reqId, 'warn', 'faceRestore.crop.fail', {
        message: err?.message,
        cropRect,
      });
      restoreInputImage = image;
    }
  }

  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  const model = modelRef || resolveFaceRestoreModel();
  const fidelity = resolveCodeformerFidelity();
  const input = {
    image: toDataUri(restoreInputImage),
    codeformer_fidelity: fidelity,
    // Leave Gemini's rendered background alone — we only want to restore the
    // swapped face region, not re-grade the whole scene.
    background_enhance: false,
    face_upsample: true,
    upscale: 1,
  };

  const start = Date.now();
  try {
    const output = await withTimeout(
      replicate.run(model, { input }),
      RESTORE_TIMEOUT_MS,
      () => Object.assign(new Error('face-restore timeout'), { status: 'timeout' })
    );
    const restoredCrop = await fetchOutputAsBuffer(output);
    if (!restoredCrop) {
      log?.(reqId, 'warn', 'faceRestore.noOutput', {
        ms: Date.now() - start,
        outputType: Array.isArray(output) ? 'array' : typeof output,
        outputLength: Array.isArray(output) ? output.length : undefined,
        firstItemType: Array.isArray(output) ? typeof output[0] : undefined,
        firstItemCtor:
          Array.isArray(output) && output[0]
            ? output[0]?.constructor?.name
            : output?.constructor?.name,
      });
      return null;
    }

    if (!scoped || restoreInputImage === image) {
      log?.(reqId, 'log', 'faceRestore.ok', {
        ms: Date.now() - start,
        outBytes: restoredCrop.buf.length,
        outMime: restoredCrop.mime,
        fidelity,
        scoped: false,
      });
      return restoredCrop;
    }

    let composed;
    try {
      composed = await compositeIntoRegion({
        base: image,
        replacement: restoredCrop.buf,
        cropRect,
      });
    } catch (err) {
      log?.(reqId, 'error', 'faceRestore.composite.fail', {
        message: err?.message,
        cropRect,
      });
      return null;
    }

    log?.(reqId, 'log', 'faceRestore.ok', {
      ms: Date.now() - start,
      outBytes: composed.length,
      outMime: 'image/png',
      fidelity,
      scoped: true,
      cropRect,
    });
    return { mime: 'image/png', buf: composed };
  } catch (err) {
    log?.(reqId, 'error', 'faceRestore.fail', {
      message: err?.message,
      status: err?.status,
      ms: Date.now() - start,
    });
    return null;
  }
}
