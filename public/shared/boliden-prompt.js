// Facade for the Boliden prompt subsystem. The real implementations live in
// ./boliden/*.js, split by concern: identity, scene, constraints, insert
// (single-pass selfie+scene composite), and scene-only (two-pass pre-swap).
//
// Kept as a stable import path so existing callers don't break when the
// internal module layout shifts.

import { BOLIDEN_SCENE_LIBRARY, COMPANY_IDS } from './company-scenes.js';
import { buildInsertPrompt } from './boliden/prompt-insert.js';

export {
  buildIdentityLockBlock,
  describePersonAppearance,
} from './boliden/identity.js';
export {
  buildSceneIntegrationBlock,
  buildVisualIntegrationBlock,
} from './boliden/scene.js';
export { buildConstraintsBlock } from './boliden/constraints.js';
export { buildInsertPrompt } from './boliden/prompt-insert.js';

// Back-compat alias: older callers imported `buildBolidenPrompt`.
export function buildBolidenPrompt(scene, personBrief, suffixes) {
  return buildInsertPrompt(scene, personBrief, suffixes);
}

// Back-compat alias: resolves the single-pass prompt for a request. New
// callers should use the strategy selector in api/strategies/index.js
// instead.
export function resolveGenerationStrategy({
  company,
  originalPrompt,
  sceneId,
  personBrief,
  qualitySuffix,
  compositeQualitySuffix,
}) {
  if (company === COMPANY_IDS.BOLIDEN) {
    const scene = sceneId ? BOLIDEN_SCENE_LIBRARY[sceneId] : null;
    if (scene) {
      const { prompt, fallbackPrompt } = buildInsertPrompt(scene, personBrief, {
        qualitySuffix,
        compositeQualitySuffix,
      });
      return { prompt, fallbackPrompt, scene };
    }
  }
  const prompt = `${originalPrompt}${qualitySuffix || ''}`;
  return { prompt, fallbackPrompt: prompt, scene: null };
}
