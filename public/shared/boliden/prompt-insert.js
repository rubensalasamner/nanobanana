// Single-pass composite prompt: selfie (image 2) + scene (image 1) -> final image.

import { buildIdentityLockBlock } from './identity.js';
import { buildSceneIntegrationBlock, buildVisualIntegrationBlock } from './scene.js';
import { buildConstraintsBlock } from './constraints.js';

// `options.faceWillBeSwapped` — when true (two-pass strategy), the identity
// block becomes a placeholder-face instruction so Gemini doesn't portraitize
// the crop. The final face is restored by the downstream face-swap step.
export function buildInsertPrompt(scene, personBrief, suffixes, options = {}) {
  const { qualitySuffix = '', compositeQualitySuffix = '' } = suffixes || {};
  const { faceWillBeSwapped = false } = options;
  const identityComposite = buildIdentityLockBlock(personBrief, true, { faceWillBeSwapped });
  const identityFallback = buildIdentityLockBlock(personBrief, false, { faceWillBeSwapped });
  const compositeSuffix = (compositeQualitySuffix || qualitySuffix || '').trim();
  const fallbackSuffix = (qualitySuffix || '').trim();
  const replace = scene.replaceReferenceSubject === true;

  const intro = replace
    ? [
        `Image 1: scene, composition, framing, and lighting reference — the Boliden "${scene.label}" scene showing a colleague at the machine.`,
        'Image 2: face/identity reference ONLY — a portrait selfie of the person whose face must appear in the output.',
        '',
        'Produce one photorealistic composite. Keep image 1\'s vehicle, environment, lighting, and framing. Replace the visible coworker in image 1 with a person whose face matches image 2 exactly, fitted to the same pose and scale. The result should look like a colleague took this photo of them at work.',
      ].join('\n')
    : [
        `Image 1: scene, composition, framing, and lighting reference — the Boliden "${scene.label}" work environment. Image 1 dictates the shot, the composition, the lighting, and everything already visible in the frame.`,
        'Image 2: face/identity reference ONLY. Use image 2 solely to copy the person\'s face onto a new figure added to image 1. Image 2 does NOT dictate framing, pose, composition, or subject emphasis.',
        '',
        'REQUIRED OUTPUT: one photorealistic composite that is a wide or medium-wide environmental/documentary photograph of the work scene in image 1 — NOT a portrait. You MUST add exactly one NEW person to the scene whose face matches image 2. This new person is additive: keep every existing worker and all equipment from image 1, and add the new person alongside them. Total person count in the output = (persons already in image 1) + 1. If the output does not contain this new additional person with the face from image 2, the output fails.',
      ].join('\n');

  const fallbackIntro = replace
    ? [
        'Image provided: portrait selfie — this is the face/identity reference for the person.',
        '',
        `Produce one photorealistic on-site photograph of that person in a Boliden "${scene.label}" situation: at an industrial vehicle in an underground mine, taking the place of a colleague in that pose. Match machine lighting, hi-vis PPE, and hard hat with headlamp.`,
      ].join('\n')
    : [
        'Image provided: portrait selfie — this is the face/identity reference for the person.',
        '',
        `Produce one photorealistic on-site photograph of that person working in a Boliden "${scene.label}" environment. The result should look like a colleague took this photo of them at work.`,
      ].join('\n');

  const prompt = [
    intro,
    identityComposite,
    buildSceneIntegrationBlock(scene, true),
    buildVisualIntegrationBlock(true),
    buildConstraintsBlock(true, scene),
    compositeSuffix,
  ]
    .filter(Boolean)
    .join('\n\n');

  const fallbackPrompt = [
    fallbackIntro,
    identityFallback,
    buildSceneIntegrationBlock(scene, false),
    buildVisualIntegrationBlock(false),
    buildConstraintsBlock(false, scene),
    fallbackSuffix,
  ]
    .filter(Boolean)
    .join('\n\n');

  return { prompt, fallbackPrompt };
}
