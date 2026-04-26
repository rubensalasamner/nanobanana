// Targeted face swap: detect the newly-added face, crop just that region,
// run Replicate face-swap on the crop, and paste the result back into the
// full image with a feathered alpha edge.
//
// Why this exists: `cdingram/face-swap` (and every other single-face InsightFace
// wrapper we tested) always targets the most prominent face in its input. In
// multi-person Boliden scenes (water-samples, coffee-break) the "most prominent"
// face is frequently an existing worker rather than the newly-added visitor.
// That caused the bug where the visitor was added but got an unrelated face,
// while an existing worker ended up wearing the user's selfie.
//
// Solution: narrow the swap's attention to a crop that only contains the new
// face. The bounding box comes from api/faceDetect.js (Gemini vision).
//
// Degradation: every step can fail (detection returns null, the crop is too
// small, the swap call fails). In every failure mode this function returns
// {ok:false, image:null} and the caller (api/postProcessFace.js) falls back
// to the current full-frame swap. So enabling targeted swap never makes the
// output worse than the previous pipeline — it can only make it better.

import sharp from 'sharp';

import { compositeIntoRegion, extractCrop } from './cropComposite.js';
import { detectNewFaceBbox, isFaceDetectEnabled } from './faceDetect.js';
import { swapFace } from './faceSwap.js';

// Context to include around the detected face. Face-swap models produce the
// best edge-blend when given chin, hair, and neck/collar context, not just
// the tight face crop.
const CROP_PADDING_FACTOR = 0.75;

// Minimum face size (in normalized units of min image dimension) to attempt
// targeted swap. Below this, the crop is too small to swap cleanly — fall back
// to full-frame swap, which handles small faces better.
const MIN_FACE_NORM = 0.03;

// Minimum absolute crop size in pixels. cdingram/face-swap internally uses
// inswapper_128 (128×128), so anything smaller than ~128 in either dimension
// adds no value vs a full-frame swap.
const MIN_CROP_PX = 128;

// Composition diagnostic thresholds. The placeholder/strict prompts both ask
// for the new worker's head to be 10–14% of frame height (placeholder) or
// 6–10% (strict). Anything wider than ~13% horizontally or taller than ~18%
// vertically is a foreground-hero composition — Gemini overruled the
// "mid-ground, side third" constraint and produced a portrait close-up
// instead. We surface this as a `composition.faceSize` log with a
// `foregroundHero` flag so the rate is grep-able; we do not retry (would
// double Gemini latency) and we do not block the swap (the swap targeting
// is correct regardless of the close-up).
const FOREGROUND_HERO_FRAC_W = 0.13;
const FOREGROUND_HERO_FRAC_H = 0.18;

/**
 * Pure check exposed for the smoke test. Returns true when the normalized
 * face bbox exceeds either dimension threshold.
 *
 * @param {{xMinNorm:number,xMaxNorm:number,yMinNorm:number,yMaxNorm:number}|null} normBox
 * @param {{widthFrac?:number,heightFrac?:number}} [thresholds]
 * @returns {boolean}
 */
export function isForegroundHero(normBox, thresholds = {}) {
  if (!normBox) return false;
  const wMax = thresholds.widthFrac ?? FOREGROUND_HERO_FRAC_W;
  const hMax = thresholds.heightFrac ?? FOREGROUND_HERO_FRAC_H;
  const w = normBox.xMaxNorm - normBox.xMinNorm;
  const h = normBox.yMaxNorm - normBox.yMinNorm;
  return w > wMax || h > hMax;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * @returns {boolean}
 */
export function isTargetedFaceSwapAvailable() {
  return isFaceDetectEnabled();
}

function expandBoxWithPadding(normBox, paddingFactor, width, height) {
  const faceW = (normBox.xMaxNorm - normBox.xMinNorm) * width;
  const faceH = (normBox.yMaxNorm - normBox.yMinNorm) * height;
  const padX = Math.round(faceW * paddingFactor);
  const padY = Math.round(faceH * paddingFactor);

  const left = Math.max(0, Math.round(normBox.xMinNorm * width) - padX);
  const top = Math.max(0, Math.round(normBox.yMinNorm * height) - padY);
  const right = Math.min(width, Math.round(normBox.xMaxNorm * width) + padX);
  const bottom = Math.min(height, Math.round(normBox.yMaxNorm * height) + padY);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * @typedef {Object} TargetedFaceSwapResult
 * @property {boolean} ok
 * @property {'ok'|'disabled'|'missing-inputs'|'no-metadata'|'no-bbox'|'tiny-face'|'crop-too-small'|'swap-failed'|'composite-failed'} reason
 * @property {'no_face_found'|'timeout'|'api_error'|'no_output'|'disabled'|'missing_inputs'|null} [swapReason]
 *   Subclassifies a `swap-failed` outcome with the upstream swapFace reason.
 *   Lets the caller decide whether to fall back (timeout/api_error) or
 *   surface a user-visible fatal (no_face_found).
 * @property {{mime:string, buf:Buffer}|null} image
 * @property {{left:number,top:number,width:number,height:number}|null} [cropRect]
 * @property {number} [detectMs]
 * @property {number} [swapMs]
 */

/**
 * @param {object} args
 * @param {{mime:string,buf:Buffer}} args.modifiedImage
 * @param {{mime:string,buf:Buffer}} args.originalScene
 * @param {{mime:string,buf:Buffer}} args.selfie
 * @param {string} [args.apiKey]
 * @param {string} [args.reqId]
 * @param {Function} [args.log]
 * @returns {Promise<TargetedFaceSwapResult>}
 */
export async function applyTargetedFaceSwap({
  modifiedImage,
  originalScene,
  selfie,
  apiKey,
  reqId,
  log,
}) {
  if (!isFaceDetectEnabled()) {
    return { ok: false, reason: 'disabled', image: null };
  }
  if (!modifiedImage?.buf || !originalScene?.buf || !selfie?.buf) {
    log?.(reqId, 'warn', 'targetedSwap.skip.missingInputs', {
      hasModified: Boolean(modifiedImage?.buf),
      hasOriginal: Boolean(originalScene?.buf),
      hasSelfie: Boolean(selfie?.buf),
    });
    return { ok: false, reason: 'missing-inputs', image: null };
  }

  const meta = await sharp(modifiedImage.buf).metadata();
  if (!meta?.width || !meta?.height) {
    log?.(reqId, 'warn', 'targetedSwap.skip.noMetadata');
    return { ok: false, reason: 'no-metadata', image: null };
  }
  const { width, height } = meta;

  const detectStart = Date.now();
  const normBox = await detectNewFaceBbox({
    modifiedImage,
    originalScene,
    apiKey,
    reqId,
    log,
  });
  const detectMs = Date.now() - detectStart;
  if (!normBox) {
    return { ok: false, reason: 'no-bbox', image: null, detectMs };
  }

  const faceNormW = normBox.xMaxNorm - normBox.xMinNorm;
  const faceNormH = normBox.yMaxNorm - normBox.yMinNorm;
  const foregroundHero = isForegroundHero(normBox);
  log?.(reqId, foregroundHero ? 'warn' : 'log', 'composition.faceSize', {
    faceFracW: round3(faceNormW),
    faceFracH: round3(faceNormH),
    foregroundHero,
    thresholds: { w: FOREGROUND_HERO_FRAC_W, h: FOREGROUND_HERO_FRAC_H },
  });
  if (Math.min(faceNormW, faceNormH) < MIN_FACE_NORM) {
    log?.(reqId, 'warn', 'targetedSwap.skip.tinyFace', { faceNormW, faceNormH });
    return { ok: false, reason: 'tiny-face', image: null, detectMs };
  }

  const cropRect = expandBoxWithPadding(normBox, CROP_PADDING_FACTOR, width, height);
  if (cropRect.width < MIN_CROP_PX || cropRect.height < MIN_CROP_PX) {
    log?.(reqId, 'warn', 'targetedSwap.skip.cropTooSmall', cropRect);
    return { ok: false, reason: 'crop-too-small', image: null, detectMs, cropRect };
  }

  let cropBuf;
  try {
    cropBuf = await extractCrop({ image: modifiedImage, cropRect });
  } catch (err) {
    log?.(reqId, 'error', 'targetedSwap.crop.fail', {
      message: err?.message,
      cropRect,
    });
    return { ok: false, reason: 'crop-too-small', image: null, detectMs, cropRect };
  }

  log?.(reqId, 'log', 'targetedSwap.crop.ok', {
    cropRect,
    cropBytes: cropBuf.length,
    detectMs,
  });

  const swapStart = Date.now();
  const swapResult = await swapFace({
    targetImage: { mime: 'image/png', buf: cropBuf },
    sourceFace: selfie,
    reqId,
    log,
  });
  const swapMs = Date.now() - swapStart;

  if (!swapResult?.image?.buf) {
    const swapReason = swapResult?.reason ?? 'no_output';
    log?.(reqId, 'warn', 'targetedSwap.swap.failed', { swapMs, swapReason });
    return {
      ok: false,
      reason: 'swap-failed',
      swapReason,
      image: null,
      detectMs,
      swapMs,
      cropRect,
    };
  }

  const swapped = swapResult.image;

  try {
    const composed = await compositeIntoRegion({
      base: modifiedImage,
      replacement: swapped.buf,
      cropRect,
    });

    log?.(reqId, 'log', 'targetedSwap.composite.ok', {
      outBytes: composed.length,
      cropRect,
      detectMs,
      swapMs,
    });

    return {
      ok: true,
      reason: 'ok',
      image: { mime: 'image/png', buf: composed },
      cropRect,
      detectMs,
      swapMs,
    };
  } catch (err) {
    log?.(reqId, 'error', 'targetedSwap.composite.fail', {
      message: err?.message,
      cropRect,
    });
    return { ok: false, reason: 'composite-failed', image: null, detectMs, swapMs, cropRect };
  }
}
