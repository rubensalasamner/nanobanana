import { COMPANY_IDS } from '../../public/shared/company-scenes.js';
import { isFaceSwapAvailable } from '../faceSwap.js';
import { applyFaceSwapAndRestore } from '../postProcessFace.js';

function strategyNameFromOutcome(base, outcome) {
  if (outcome === 'ok') return `${base}+restore`;
  if (outcome === 'no-restore') return `${base}:no-restore`;
  if (outcome === 'no-swap') return `${base}:no-swap`;
  return `${base}:skipped`;
}

/** @type {import('./types.js').GenerationStrategy} */
export const faceSwapOnlyStrategy = {
  name: 'face-swap-only',

  supportedSceneIds: new Set(['coworker-with-machine']),

  canHandle(ctx) {
    if (ctx.company !== COMPANY_IDS.BOLIDEN) return false;
    if (ctx.clientMode !== 'mobile') return false;
    if (ctx.pipeline !== 'swap-only') return false;
    if (!ctx.scene) return false;
    if (!this.supportedSceneIds.has(ctx.scene.id)) return false;
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

    const strategyName = strategyNameFromOutcome(this.name, post.outcome);
    ctx.log(ctx.reqId, 'log', 'strategy.swapOnly.result', {
      outcome: post.outcome,
      strategyName,
    });

    return {
      image: post.image,
      strategyName,
      debug: {
        pipeline: 'swap-only',
        outcome: post.outcome,
        swapBytes: post.swappedImage?.buf?.length ?? null,
        restoreBytes: post.restoredImage?.buf?.length ?? null,
      },
      debugImages: post.swappedImage ? { pass1: ctx.sceneImage, pass2: post.swappedImage } : null,
    };
  },
};

