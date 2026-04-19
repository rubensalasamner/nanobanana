// Two-pass Boliden strategy: Gemini produces the scene composite with the user
// in it (using the proven single-pass insert prompt), then a dedicated
// face-swap model replaces the Gemini-rendered face with the user's actual
// face from the selfie.
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
//     strategyName suffixed `:pass1-only` so the caller can see swap was
//     skipped.

import { COMPANY_IDS } from '../../public/shared/company-scenes.js';
import { buildInsertPrompt } from '../../public/shared/boliden/prompt-insert.js';
import { runGeminiEdit } from '../geminiClient.js';
import { isFaceSwapAvailable, swapFace } from '../faceSwap.js';

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
    const { prompt, fallbackPrompt } = buildInsertPrompt(
      ctx.scene,
      ctx.personBrief,
      {
        qualitySuffix: ctx.aspectPreset.qualitySuffix,
        compositeQualitySuffix: ctx.aspectPreset.compositeQualitySuffix,
      },
      { faceWillBeSwapped: true }
    );
    const hasScene = !!ctx.sceneImage;
    const pass1Prompt = hasScene ? prompt : fallbackPrompt;

    ctx.log(ctx.reqId, 'log', 'strategy.twoPass.pass1.request', {
      promptLength: pass1Prompt.length,
      sceneId: ctx.scene.id,
      outputAspect: ctx.aspectPreset.id,
      mode: hasScene ? 'composite' : 'text-only',
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

    const swapped = await swapFace({
      targetImage: pass1Image,
      sourceFace: ctx.selfie,
      reqId: ctx.reqId,
      log: ctx.log,
    });

    if (!swapped) {
      ctx.log(ctx.reqId, 'warn', 'strategy.twoPass.pass2.degraded', {
        reason: 'face-swap returned null; using pass1 image',
      });
      return {
        image: pass1Image,
        strategyName: `${this.name}:pass1-only`,
        debug: { pass1Only: true },
      };
    }

    return {
      image: swapped,
      strategyName: this.name,
      debug: {
        pass1Bytes: pass1Image.buf.length,
        pass2Bytes: swapped.buf.length,
      },
    };
  },
};
