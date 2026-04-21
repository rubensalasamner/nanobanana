// Shared identity-locking post-processing used by every Boliden strategy.
//
// Given an image that already contains a rendered person and the original
// selfie, this chains the stages that actually enforce identity:
//
//   1. swapFace  — replaces the rendered face with the selfie face using
//                  InsightFace (cdingram/face-swap by default).
//                  When `originalScene` is supplied and targeted swap is
//                  enabled, the swap runs against a crop of the newly-added
//                  face only (via api/targetedFaceSwap.js) so it cannot
//                  re-target an existing worker in multi-person scenes.
//                  On any failure along the targeted path (no bbox, crop too
//                  small, crop swap failed) we fall back to the classic
//                  full-frame swap.
//   2. restoreFace — runs CodeFormer on the swap output to reintroduce skin
//                    texture and blend edges (targets the inswapper_128
//                    smoothness artifact).
//
// Every stage degrades gracefully: a failure at any step returns the latest
// successful image rather than throwing. Callers receive a normalized result
// describing what actually ran, so strategies can reflect that in their
// strategyName and the request log.
//
// This helper exists so every strategy (two-pass Gemini, single-pass fallback,
// and any future alternate Pass 1 producer) can share one code path for
// identity locking. It is deliberately model-agnostic on the input side — it
// does not care how the composite was produced, only that it contains a face
// and that a selfie is available.

import { isFaceSwapAvailable, swapFace } from './faceSwap.js';
import { isFaceRestoreEnabled, restoreFace } from './faceRestore.js';
import { applyTargetedFaceSwap, isTargetedFaceSwapAvailable } from './targetedFaceSwap.js';

/**
 * @typedef {Object} PostProcessResult
 * @property {{mime:string, buf:Buffer}} image          - Best image produced by the pipeline.
 * @property {{mime:string, buf:Buffer}|null} swappedImage
 * @property {{mime:string, buf:Buffer}|null} restoredImage
 * @property {boolean} swapped                          - swap step returned an image.
 * @property {boolean} restored                         - restore step returned an image.
 * @property {boolean} targeted                         - targeted (crop-based) swap ran.
 * @property {'ok'|'no-swap'|'no-restore'|'skipped'} outcome
 *        ok         = swap + restore both ran
 *        no-restore = swap ran, restore disabled or failed
 *        no-swap    = swap failed; original image returned
 *        skipped    = post-processing not attempted (no token, missing inputs, disabled)
 */

/**
 * @returns {boolean}
 */
export function isPostProcessFaceAvailable() {
  return isFaceSwapAvailable();
}

/**
 * Run swap + restore on `image` using `selfie` as the identity source.
 * When `originalScene` is supplied, the swap step tries a targeted (crop-based)
 * swap first and falls back to a full-frame swap on any failure.
 *
 * @param {{
 *   image:{mime:string,buf:Buffer},
 *   selfie:{mime:string,buf:Buffer},
 *   originalScene?:{mime:string,buf:Buffer}|null,
 *   apiKey?:string,
 *   reqId:string,
 *   log:Function,
 * }} args
 * @returns {Promise<PostProcessResult>}
 */
export async function applyFaceSwapAndRestore({
  image,
  selfie,
  originalScene = null,
  apiKey,
  reqId,
  log,
}) {
  if (!image?.buf || !selfie?.buf || !isFaceSwapAvailable()) {
    log?.(reqId, 'log', 'postProcess.skipped', {
      reason: !image?.buf
        ? 'no-image'
        : !selfie?.buf
        ? 'no-selfie'
        : 'face-swap-unavailable',
    });
    return {
      image,
      swappedImage: null,
      restoredImage: null,
      swapped: false,
      restored: false,
      targeted: false,
      outcome: 'skipped',
    };
  }

  let swapped = null;
  let targeted = false;

  // Targeted path: only attempted when the caller provided the original scene
  // (so Gemini has a baseline to diff against) and the detect+target feature
  // is enabled. Any failure inside this block falls through to the full-frame
  // swap below — we never let a targeted-swap miss fail the whole pipeline.
  if (originalScene?.buf && isTargetedFaceSwapAvailable()) {
    const targetedResult = await applyTargetedFaceSwap({
      modifiedImage: image,
      originalScene,
      selfie,
      apiKey,
      reqId,
      log,
    });
    if (targetedResult.ok && targetedResult.image?.buf) {
      swapped = targetedResult.image;
      targeted = true;
    } else {
      log?.(reqId, 'log', 'postProcess.targetedSwap.fallback', {
        reason: targetedResult.reason,
      });
    }
  }

  if (!swapped) {
    swapped = await swapFace({
      targetImage: image,
      sourceFace: selfie,
      reqId,
      log,
    });
  }

  if (!swapped) {
    return {
      image,
      swappedImage: null,
      restoredImage: null,
      swapped: false,
      restored: false,
      targeted: false,
      outcome: 'no-swap',
    };
  }

  if (!isFaceRestoreEnabled()) {
    return {
      image: swapped,
      swappedImage: swapped,
      restoredImage: null,
      swapped: true,
      restored: false,
      targeted,
      outcome: 'no-restore',
    };
  }

  const restored = await restoreFace({ image: swapped, reqId, log });
  if (!restored) {
    return {
      image: swapped,
      swappedImage: swapped,
      restoredImage: null,
      swapped: true,
      restored: false,
      targeted,
      outcome: 'no-restore',
    };
  }

  return {
    image: restored,
    swappedImage: swapped,
    restoredImage: restored,
    swapped: true,
    restored: true,
    targeted,
    outcome: 'ok',
  };
}
