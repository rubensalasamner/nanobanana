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
// When the scene image is available, the shared post-processor uses
// targeted (crop-based) face swap driven by Gemini bbox detection so the
// Replicate swap model cannot re-target an existing worker in multi-person
// scenes. Any failure in the targeted path falls back transparently to the
// old full-frame swap.
//
// Falls back to a selfie-only (no scene reference) prompt if the scene image
// could not be loaded.

import { COMPANY_IDS } from '../../public/shared/company-scenes.js';
import { buildInsertPrompt } from '../../public/shared/boliden/prompt-insert.js';
import { resolveBolidenSlimPrompts } from '../bolidenPromptOptions.js';
import { runGeminiEdit } from '../geminiClient.js';
import { applyFaceSwapAndRestore, isPostProcessFaceAvailable } from '../postProcessFace.js';

import { NO_FACE_FOUND_MESSAGE } from './types.js';

function strategyNameFromOutcome(baseName, outcome, targeted) {
  const targetedSuffix = targeted ? '+targeted' : '';
  switch (outcome) {
    case 'ok':
      return `${baseName}${targetedSuffix}+swap+restore`;
    case 'no-restore':
      return `${baseName}${targetedSuffix}+swap`;
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

    // When the post-process face-swap will run, identity gets locked
    // downstream by InsightFace and the strict identity-lock prompt is
    // wasted effort that *also* drags Gemini toward portrait/foreground
    // framing (it interprets "copy this face exactly" as "make the face
    // large and clearly visible", overruling the no-portrait/mid-ground
    // constraints in the same prompt).
    //
    // Switching to placeholder mode here aligns single-pass with two-pass
    // Pass 1 (which has used placeholder mode all along) and gives Gemini a
    // single coherent goal: produce a documentary composite with one new
    // worker — any plausible face there, the swap step replaces it.
    //
    // Trade-off: if the swap step then fails for a non-fatal reason
    // (timeout / api_error / no_output, all rare on cdingram/face-swap), the
    // degraded image will contain Gemini's placeholder face rather than a
    // strictly identity-locked one. Acceptable: no_face_found is already
    // surfaced as a 422, and the other reasons are rare enough that the
    // gain in normal-case composition outweighs that edge case.
    const swapWillRun = isPostProcessFaceAvailable() && !!ctx.selfie?.buf;

    const { prompt, fallbackPrompt } = buildInsertPrompt(
      ctx.scene,
      ctx.personBrief,
      {
        qualitySuffix: ctx.aspectPreset.qualitySuffix,
        compositeQualitySuffix: ctx.aspectPreset.compositeQualitySuffix,
      },
      {
        slim,
        aspectId: ctx.aspectPreset.id,
        visitorBadgeText,
        faceWillBeSwapped: swapWillRun,
      }
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
      placeholderMode: swapWillRun,
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
      originalScene: ctx.sceneImage ?? null,
      apiKey: ctx.geminiApiKey,
      reqId: ctx.reqId,
      log: ctx.log,
    });

    if (post.outcome === 'no-swap' && post.swapReason === 'no_face_found') {
      // See two-pass-face-swap.js for the rationale: this is a user-fixable
      // failure mode, not infra flakiness, so surface it instead of serving
      // a Gemini-painted face with no identity lock.
      ctx.log(ctx.reqId, 'warn', 'strategy.singlePass.fatal', {
        reason: 'no_face_found',
      });
      return {
        fatalReason: 'no_face_found',
        fatalMessage: NO_FACE_FOUND_MESSAGE,
      };
    }

    const strategyName = strategyNameFromOutcome(this.name, post.outcome, post.targeted);

    ctx.log(ctx.reqId, 'log', 'strategy.singlePass.postProcess', {
      outcome: post.outcome,
      swapped: post.swapped,
      restored: post.restored,
      targeted: post.targeted,
      swapReason: post.swapReason ?? null,
      finalName: strategyName,
    });

    return {
      image: post.image,
      strategyName,
      debug: {
        hasScene,
        postProcessed: post.swapped,
        postProcessOutcome: post.outcome,
        targeted: post.targeted,
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
