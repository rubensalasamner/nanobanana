// Eligibility is driven entirely by scene metadata (`scene.primaryFace`). A
// scene declares itself a swap-only target by including
// `primaryFace: { strategy: 'swap-only' }`; the strategy does not maintain a
// separate allow-list. This keeps the registry the single source of truth
// for "which strategy fits which scene".
//
// Restricted to mobile clients on purpose: booth flows have different
// fidelity/time budgets and may want the higher-fidelity two-pass output
// even for single-person scenes. Lift this constraint per-scene if needed.
//
// Hair-length gate
// ----------------
// InsightFace (cdingram/face-swap) only swaps the face region — eyes, nose,
// mouth, skin, inner face shape. It does not touch hair, ears, or hairline.
// So a long-haired selfie onto a short-haired body keeps the body's short
// hair, and vice-versa, which reads as the wrong gender presentation.
//
// To avoid that failure mode, scenes with a strong hair signal declare it as
// `primaryFace.hair = { length: 'short'|'long'|'medium' }`. We compare it
// against the selfie's parsed `Hair:` line at strategy-selection time. A
// strict short↔long clash makes the strategy decline; the selector falls
// through to two-pass, where Gemini renders a fresh body whose hair matches
// the selfie. medium and unknown are compatible with everything — we only
// block on positive evidence of a mismatch, never on a flaky parse.

import { parseHairLength } from '../../public/shared/boliden/index.js';
import { COMPANY_IDS } from '../../public/shared/company-scenes.js';
import { isFaceSwapAvailable } from '../faceSwap.js';
import { applyFaceSwapAndRestore } from '../postProcessFace.js';

import { NO_FACE_FOUND_MESSAGE } from './types.js';

/**
 * Returns true if the selfie's hair length is compatible with the scene's
 * declared hair length. Compatibility rules:
 *   - identical buckets are compatible (short=short, long=long, medium=medium)
 *   - 'medium' is compatible with anything (including short and long)
 *   - 'short' and 'long' are mutually incompatible — the only blocking case
 *   - any null (unknown selfie hair, scene without hair metadata) is
 *     compatible: we only fall back on positive evidence of a clash
 *
 * @param {string|null|undefined} selfieLength
 * @param {string|null|undefined} sceneLength
 * @returns {boolean}
 */
export function isHairCompatible(selfieLength, sceneLength) {
  if (!selfieLength || !sceneLength) return true;
  if (selfieLength === sceneLength) return true;
  if (selfieLength === 'medium' || sceneLength === 'medium') return true;
  return false;
}

function strategyNameFromOutcome(base, outcome) {
  if (outcome === 'ok') return `${base}+restore`;
  if (outcome === 'no-restore') return `${base}:no-restore`;
  if (outcome === 'no-swap') return `${base}:no-swap`;
  return `${base}:skipped`;
}

/** @type {import('./types.js').GenerationStrategy} */
export const faceSwapOnlyStrategy = {
  name: 'face-swap-only',

  canHandle(ctx) {
    if (ctx.company !== COMPANY_IDS.BOLIDEN) return false;
    if (ctx.clientMode !== 'mobile') return false;
    if (!ctx.scene) return false;
    if (ctx.scene.primaryFace?.strategy !== 'swap-only') return false;
    if (!ctx.sceneImage?.buf) return false;
    if (!isFaceSwapAvailable()) return false;

    const sceneHair = ctx.scene.primaryFace.hair?.length ?? null;
    const selfieHair = parseHairLength(ctx.personBrief);
    if (!isHairCompatible(selfieHair, sceneHair)) {
      ctx.log?.(ctx.reqId, 'log', 'strategy.swapOnly.declineHairMismatch', {
        sceneId: ctx.scene.id,
        sceneHair,
        selfieHair,
      });
      return false;
    }
    return true;
  },

  async generate(ctx) {
    ctx.log(ctx.reqId, 'log', 'strategy.swapOnly.request', {
      sceneId: ctx.scene?.id ?? null,
      clientMode: ctx.clientMode ?? null,
      targetBytes: ctx.sceneImage?.buf?.length ?? null,
    });

    const post = await applyFaceSwapAndRestore({
      image: ctx.sceneImage,
      selfie: ctx.selfie,
      reqId: ctx.reqId,
      log: ctx.log,
    });

    if (post.outcome === 'no-swap' && post.swapReason === 'no_face_found') {
      // This strategy's "degraded" fallback is to return the untouched scene
      // image, which looks to the user like the flow did nothing. Surface
      // the real reason instead. See two-pass-face-swap.js for full rationale.
      ctx.log(ctx.reqId, 'warn', 'strategy.swapOnly.fatal', {
        reason: 'no_face_found',
      });
      return {
        fatalReason: 'no_face_found',
        fatalMessage: NO_FACE_FOUND_MESSAGE,
      };
    }

    const strategyName = strategyNameFromOutcome(this.name, post.outcome);
    ctx.log(ctx.reqId, 'log', 'strategy.swapOnly.result', {
      outcome: post.outcome,
      swapReason: post.swapReason ?? null,
      strategyName,
    });

    return {
      image: post.image,
      strategyName,
      debug: {
        primaryFaceStrategy: 'swap-only',
        outcome: post.outcome,
        swapReason: post.swapReason ?? null,
        swapBytes: post.swappedImage?.buf?.length ?? null,
        restoreBytes: post.restoredImage?.buf?.length ?? null,
      },
      debugImages: post.swappedImage ? { pass1: ctx.sceneImage, pass2: post.swappedImage } : null,
    };
  },
};

