// Single-pass Boliden strategy: selfie + scene + prompt -> final image.
//
// This is the baseline behaviour that existed before the strategy pattern was
// introduced. It uses the insert-prompt variant that treats the scene as
// "image 1" and the selfie as "image 2" and asks Gemini to produce one
// photorealistic composite in a single call.
//
// After Gemini produces the composite, we optionally run the shared
// swap+restore identity-locking step (api/postProcessFace.js). This matters
// when two-pass-face-swap aborts (IMAGE_OTHER, 503) and the pipeline falls
// through to this strategy — without post-processing, fallback runs used to
// serve a Gemini-painted face with no identity lock. Applying the same Pass 2
// + Pass 3 used by two-pass closes that fidelity gap.
//
// Known caveat: `cdingram/face-swap` targets the most prominent face in the
// input image. In scenes with multiple existing workers, if Gemini rendered
// the new person smaller than an existing worker, the swap can re-target an
// existing worker. Accepted tradeoff for now — fixing it requires face-count
// gating or a face-swap model that accepts a source-face location hint.
//
// Falls back to a selfie-only (no scene reference) prompt if the scene image
// could not be loaded.

import { COMPANY_IDS } from '../../public/shared/company-scenes.js';
import { buildInsertPrompt } from '../../public/shared/boliden/prompt-insert.js';
import { resolveBolidenSlimPrompts } from '../bolidenPromptOptions.js';
import { runGeminiEdit } from '../geminiClient.js';
import { applyFaceSwapAndRestore, isPostProcessFaceAvailable } from '../postProcessFace.js';

function strategyNameFromOutcome(baseName, outcome) {
  switch (outcome) {
    case 'ok':
      return `${baseName}+swap+restore`;
    case 'no-restore':
      return `${baseName}+swap`;
    case 'no-swap':
    case 'skipped':
    default:
      return baseName;
  }
}

/** @type {import('./types.js').GenerationStrategy} */
export const singlePassGeminiStrategy = {
  name: 'single-pass-gemini',

  canHandle(ctx) {
    return ctx.company === COMPANY_IDS.BOLIDEN && !!ctx.scene;
  },

  async generate(ctx) {
    const slim = resolveBolidenSlimPrompts();
    const visitorBadgeText = ctx.clientMode === 'mobile' ? 'Besökare' : null;
    const { prompt, fallbackPrompt } = buildInsertPrompt(
      ctx.scene,
      ctx.personBrief,
      {
        qualitySuffix: ctx.aspectPreset.qualitySuffix,
        compositeQualitySuffix: ctx.aspectPreset.compositeQualitySuffix,
      },
      { slim, aspectId: ctx.aspectPreset.id, visitorBadgeText }
    );
    const hasScene = !!ctx.sceneImage;
    const finalPrompt = hasScene ? prompt : fallbackPrompt;

    ctx.log(ctx.reqId, 'log', 'strategy.singlePass.request', {
      promptLength: finalPrompt.length,
      hasScene,
      sceneId: ctx.scene?.id,
      outputAspect: ctx.aspectPreset.id,
      slimPrompts: slim,
      postProcessAvailable: isPostProcessFaceAvailable(),
    });

    const image = await runGeminiEdit({
      apiKey: ctx.geminiApiKey,
      prompt: finalPrompt,
      primaryImage: ctx.selfie,
      referenceImages: hasScene ? [ctx.sceneImage] : [],
      geminiAspectRatio: ctx.aspectPreset.geminiAspectRatio,
      reqId: ctx.reqId,
      log: ctx.log,
    });
    if (!image) return null;

    if (!isPostProcessFaceAvailable() || !ctx.selfie?.buf) {
      return {
        image,
        strategyName: this.name,
        debug: { hasScene, postProcessed: false },
      };
    }

    const post = await applyFaceSwapAndRestore({
      image,
      selfie: ctx.selfie,
      reqId: ctx.reqId,
      log: ctx.log,
    });

    const strategyName = strategyNameFromOutcome(this.name, post.outcome);

    ctx.log(ctx.reqId, 'log', 'strategy.singlePass.postProcess', {
      outcome: post.outcome,
      swapped: post.swapped,
      restored: post.restored,
      finalName: strategyName,
    });

    return {
      image: post.image,
      strategyName,
      debug: {
        hasScene,
        postProcessed: post.swapped,
        postProcessOutcome: post.outcome,
        geminiBytes: image.buf.length,
        swapBytes: post.swappedImage?.buf.length,
        restoreBytes: post.restoredImage?.buf.length,
      },
      debugImages: post.swapped
        ? { pass1: image, pass2: post.swappedImage }
        : { pass1: image },
    };
  },
};
