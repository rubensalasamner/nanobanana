// Boliden strategy with up to three stages:
//   Pass 1 — Gemini 2.5 Flash Image composite: scene + selfie -> full output
//            with a placeholder face (identity block is relaxed because a
//            downstream swap will replace the face anyway).
//   Pass 2 — Replicate InsightFace face-swap: replaces the Gemini-rendered
//            face with the user's actual face from the selfie.
//   Pass 3 — Replicate CodeFormer face-restore (optional): adds natural skin
//            texture, pore detail, and edge blending to the swapped face so
//            it matches surrounding image detail. Targets the inswapper_128
//            "smooth pasted face" artifact. Enabled by default, gated on
//            ENABLE_FACE_RESTORE and the presence of REPLICATE_API_TOKEN.
//
// Pass 2 + Pass 3 are delegated to api/postProcessFace.js so the same
// identity-locking step can be reused by the single-pass fallback strategy.
//
// Targeted swap: when the original scene image is available (as it is for any
// registered Boliden scene), postProcessFace will first try to swap only a
// cropped region around the newly-added face (via api/targetedFaceSwap.js and
// api/faceDetect.js). That stops the Replicate swap model from re-targeting
// an existing worker in multi-person scenes. Any failure along that path
// transparently falls back to a full-frame swap — a targeted failure never
// degrades output vs the previous pipeline.
//
// Why pass 1 reuses the insert prompt instead of a separate "scene-only"
// prompt: Gemini 2.5 Flash Image reliably handles the 2-image composite mode
// (scene + selfie). A 1-image "add a generic worker" variant was tried and
// failed frequently with finishReason IMAGE_OTHER. Face swap doesn't care
// whether pass 1's face was generic or selfie-derived — it replaces the face
// either way — so we use the reliable mode and let swap correct identity.
//
// Degradation rules (in order):
//   - If the scene image can't be loaded, use the insert prompt's text-only
//     fallback (no scene reference).
//   - If the Gemini pass fails, return null so the pipeline can try the next
//     strategy (single-pass-gemini).
//   - If the face-swap pass fails, return the Gemini pass output as-is with
//     strategyName suffixed `:pass1-only`.
//   - If face-restore is disabled or fails, return the swap output with
//     strategyName suffixed `:no-restore`. When restore succeeds, the
//     strategyName is suffixed `+restore`.

import { COMPANY_IDS } from '../../public/shared/company-scenes.js';
import { buildInsertPrompt } from '../../public/shared/boliden/prompt-insert.js';
import { resolveBolidenSlimPrompts } from '../bolidenPromptOptions.js';
import { runGeminiEdit } from '../geminiClient.js';
import { isFaceSwapAvailable } from '../faceSwap.js';
import { applyFaceSwapAndRestore } from '../postProcessFace.js';

/** @type {import('./types.js').GenerationStrategy} */
export const twoPassFaceSwapStrategy = {
  name: 'two-pass-face-swap',

  canHandle(ctx) {
    if (ctx.company !== COMPANY_IDS.BOLIDEN) return false;
    if (!ctx.scene) return false;
    if (ctx.scene.useFaceSwap === false) return false;
    return isFaceSwapAvailable();
  },

  async generate(ctx) {
    // faceWillBeSwapped=true tells the identity block to act as a placeholder
    // and demand proportional head/body geometry instead of aggressive facial
    // geometry preservation — Gemini otherwise portraitizes the crop and
    // produces an oversized head relative to the body.
    const slim = resolveBolidenSlimPrompts();
    const { prompt, fallbackPrompt } = buildInsertPrompt(
      ctx.scene,
      ctx.personBrief,
      {
        qualitySuffix: ctx.aspectPreset.qualitySuffix,
        compositeQualitySuffix: ctx.aspectPreset.compositeQualitySuffix,
      },
      { faceWillBeSwapped: true, slim, aspectId: ctx.aspectPreset.id }
    );
    const hasScene = !!ctx.sceneImage;
    const pass1Prompt = hasScene ? prompt : fallbackPrompt;

    ctx.log(ctx.reqId, 'log', 'strategy.twoPass.pass1.request', {
      promptLength: pass1Prompt.length,
      sceneId: ctx.scene.id,
      outputAspect: ctx.aspectPreset.id,
      mode: hasScene ? 'composite' : 'text-only',
      slimPrompts: slim,
    });

    const pass1Image = await runGeminiEdit({
      apiKey: ctx.geminiApiKey,
      prompt: pass1Prompt,
      primaryImage: ctx.selfie,
      referenceImages: hasScene ? [ctx.sceneImage] : [],
      geminiAspectRatio: ctx.aspectPreset.geminiAspectRatio,
      reqId: ctx.reqId,
      log: ctx.log,
    });

    if (!pass1Image) {
      ctx.log(ctx.reqId, 'warn', 'strategy.twoPass.pass1.noImage');
      return null;
    }
    ctx.log(ctx.reqId, 'log', 'strategy.twoPass.pass1.ok', {
      mime: pass1Image.mime,
      bytes: pass1Image.buf.length,
    });

    const post = await applyFaceSwapAndRestore({
      image: pass1Image,
      selfie: ctx.selfie,
      // Passing the original scene unlocks targeted (crop-based) face swap,
      // which stops cdingram/face-swap from re-targeting an existing worker
      // in multi-person scenes. Falls back to full-frame swap on any failure.
      originalScene: ctx.sceneImage ?? null,
      apiKey: ctx.geminiApiKey,
      reqId: ctx.reqId,
      log: ctx.log,
    });

    if (post.outcome === 'no-swap') {
      ctx.log(ctx.reqId, 'warn', 'strategy.twoPass.pass2.degraded', {
        reason: 'face-swap returned null; using pass1 image',
      });
      return {
        image: pass1Image,
        strategyName: `${this.name}:pass1-only`,
        debug: { pass1Only: true },
      };
    }

    const targetedSuffix = post.targeted ? '+targeted' : '';

    if (post.outcome === 'no-restore') {
      ctx.log(ctx.reqId, 'log', 'strategy.twoPass.pass3.skipped', {
        reason: 'face-restore disabled, missing token, or returned null',
        targeted: post.targeted,
      });
      return {
        image: post.image,
        strategyName: `${this.name}${targetedSuffix}:no-restore`,
        debug: {
          pass1Bytes: pass1Image.buf.length,
          pass2Bytes: post.swappedImage?.buf.length,
          restoreSkipped: true,
          targeted: post.targeted,
        },
        debugImages: {
          pass1: pass1Image,
          pass2: post.swappedImage,
        },
      };
    }

    ctx.log(ctx.reqId, 'log', 'strategy.twoPass.pass3.ok', {
      mime: post.image.mime,
      bytes: post.image.buf.length,
      targeted: post.targeted,
    });
    return {
      image: post.image,
      strategyName: `${this.name}${targetedSuffix}+restore`,
      debug: {
        pass1Bytes: pass1Image.buf.length,
        pass2Bytes: post.swappedImage?.buf.length,
        pass3Bytes: post.restoredImage?.buf.length,
        targeted: post.targeted,
      },
      debugImages: {
        pass1: pass1Image,
        pass2: post.swappedImage,
      },
    };
  },
};
