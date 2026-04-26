// Eligibility is driven entirely by scene metadata (`scene.primaryFace`). A
// scene declares itself a swap-only target by including
// `primaryFace: { strategy: 'swap-only' }`; the strategy does not maintain a
// separate allow-list. This keeps the registry the single source of truth
// for "which strategy fits which scene".
//
// Restricted to mobile clients on purpose: booth flows have different
// fidelity/time budgets and may want the higher-fidelity two-pass output
// even for single-person scenes. Lift this constraint per-scene if needed.

import { COMPANY_IDS } from '../../public/shared/company-scenes.js';
import { isFaceSwapAvailable } from '../faceSwap.js';
import { applyFaceSwapAndRestore } from '../postProcessFace.js';

import { NO_FACE_FOUND_MESSAGE } from './types.js';

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
    return isFaceSwapAvailable();
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

