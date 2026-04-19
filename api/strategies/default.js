// Default strategy: non-Boliden flow. Sends the raw prompt and the uploaded
// selfie straight to Gemini with no scene reference and no identity
// preservation pipeline.
//
// Explicitly refuses Boliden requests so that if every Boliden-specific
// strategy fails, the pipeline returns an honest error instead of silently
// producing an image that ignores the selected scene.

import { COMPANY_IDS } from '../../public/shared/company-scenes.js';
import { runGeminiEdit } from '../geminiClient.js';

/** @type {import('./types.js').GenerationStrategy} */
export const defaultStrategy = {
  name: 'default',

  canHandle(ctx) {
    return ctx.company !== COMPANY_IDS.BOLIDEN;
  },

  async generate(ctx) {
    const prompt = `${ctx.originalPrompt}${ctx.aspectPreset.qualitySuffix || ''}`;
    ctx.log(ctx.reqId, 'log', 'strategy.default.request', {
      promptLength: prompt.length,
      outputAspect: ctx.aspectPreset.id,
    });
    const image = await runGeminiEdit({
      apiKey: ctx.geminiApiKey,
      prompt,
      primaryImage: ctx.selfie,
      referenceImages: [],
      geminiAspectRatio: ctx.aspectPreset.geminiAspectRatio,
      reqId: ctx.reqId,
      log: ctx.log,
    });
    if (!image) return null;
    return { image, strategyName: this.name };
  },
};
