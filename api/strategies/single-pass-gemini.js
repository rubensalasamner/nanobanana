// Single-pass Boliden strategy: selfie + scene + prompt -> final image.
//
// This is the baseline behaviour that existed before the strategy pattern was
// introduced. It uses the insert-prompt variant that treats the scene as
// "image 1" and the selfie as "image 2" and asks Gemini to produce one
// photorealistic composite in a single call.
//
// Falls back to a selfie-only (no scene reference) prompt if the scene image
// could not be loaded.

import { COMPANY_IDS } from '../../public/shared/company-scenes.js';
import { buildInsertPrompt } from '../../public/shared/boliden/prompt-insert.js';
import { runGeminiEdit } from '../geminiClient.js';

/** @type {import('./types.js').GenerationStrategy} */
export const singlePassGeminiStrategy = {
  name: 'single-pass-gemini',

  canHandle(ctx) {
    return ctx.company === COMPANY_IDS.BOLIDEN && !!ctx.scene;
  },

  async generate(ctx) {
    const { prompt, fallbackPrompt } = buildInsertPrompt(ctx.scene, ctx.personBrief, {
      qualitySuffix: ctx.aspectPreset.qualitySuffix,
      compositeQualitySuffix: ctx.aspectPreset.compositeQualitySuffix,
    });
    const hasScene = !!ctx.sceneImage;
    const finalPrompt = hasScene ? prompt : fallbackPrompt;

    ctx.log(ctx.reqId, 'log', 'strategy.singlePass.request', {
      promptLength: finalPrompt.length,
      hasScene,
      sceneId: ctx.scene?.id,
      outputAspect: ctx.aspectPreset.id,
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
    return { image, strategyName: this.name, debug: { hasScene } };
  },
};
