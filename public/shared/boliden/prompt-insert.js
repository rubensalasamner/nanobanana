// Single-pass composite prompt: selfie (image 2) + scene (image 1) -> final image.

import { buildIdentityLockBlock } from './identity.js';
import { buildSceneIntegrationBlock, buildVisualIntegrationBlock } from './scene.js';
import { buildConstraintsBlock } from './constraints.js';

function slimCompositeSuffix(aspectId) {
  const map = {
    '16:9': '16:9 landscape',
    '1:1': '1:1 square',
    '3:4': '3:4 portrait',
  };
  const label = map[aspectId] || 'the requested aspect ratio';
  // Do NOT say "preserve image 1" alone — models treat it as "return image 1 unchanged".
  return `\n\nOutput ${label}. Base the environment on image 1 and outpaint to fill the frame if needed (no inward crop to blank). The result MUST visibly include one additional worker beyond everyone already in image 1 — output must not be a duplicate of image 1 without that extra person. Sharp detail.`;
}

// `options.faceWillBeSwapped` — when true (two-pass strategy), the identity
// block becomes a placeholder-face instruction so Gemini doesn't portraitize
// the crop. The final face is restored by the downstream face-swap step.
// `options.slim` — shorter prompt (set via BOLIDEN_SLIM_PROMPTS on the server)
// to reduce token load when debugging IMAGE_OTHER.
// `options.aspectId` — e.g. "16:9"; used only when slim is true for the short suffix.
export function buildInsertPrompt(scene, personBrief, suffixes, options = {}) {
  const { qualitySuffix = '', compositeQualitySuffix = '' } = suffixes || {};
  const { faceWillBeSwapped = false, slim = false, aspectId = '16:9' } = options;
  const identityOpts = { faceWillBeSwapped, slim };
  const identityComposite = buildIdentityLockBlock(personBrief, true, identityOpts);
  const identityFallback = buildIdentityLockBlock(personBrief, false, identityOpts);
  const compositeSuffix = slim
    ? slimCompositeSuffix(aspectId)
    : (compositeQualitySuffix || qualitySuffix || '').trim();
  const fallbackSuffix = slim ? '' : (qualitySuffix || '').trim();
  const blockOpts = { slim };
  const replace = scene.replaceReferenceSubject === true;

  const intro = replace
    ? slim
      ? [
          `Image 1: Boliden "${scene.label}" — colleague at machine. Image 2: face reference.`,
          'Replace the visible coworker with the person from image 2; keep vehicle, environment, and framing.',
        ].join('\n')
      : [
          `Image 1: scene, composition, framing, and lighting reference — the Boliden "${scene.label}" scene showing a colleague at the machine.`,
          'Image 2: face/identity reference ONLY — a portrait selfie of the person whose face must appear in the output.',
          '',
          'Produce one photorealistic composite. Keep image 1\'s vehicle, environment, lighting, and framing. Replace the visible coworker in image 1 with a person whose face matches image 2 exactly, fitted to the same pose and scale. The result should look like a colleague took this photo of them at work.',
        ].join('\n')
    : slim
      ? [
          `Image 1: scene / light / composition — Boliden "${scene.label}". Image 2: face reference only.`,
          'Add exactly ONE new hi-vis worker to the scene (new figure in the room; face ultimately from image 2). Visible headcount in the output must be GREATER than in image 1 — if you only copy image 1 with no extra person, the task fails.',
          'Keep every existing person and all equipment from image 1; do not remove anyone.',
          'Place the new worker naturally alongside existing workers — mid-ground, side third, one of the crew. Not centered, not foreground-hero, not a portrait. Head ~10–14% of frame height so the face is resolvable but the shot still reads as a documentary photo of the scene.',
        ].join('\n')
      : [
          `Image 1: scene, composition, framing, and lighting reference — the Boliden "${scene.label}" work environment. Image 1 dictates the shot, the composition, the lighting, and everything already visible in the frame.`,
          'Image 2: face/identity reference ONLY. Use image 2 solely to copy the person\'s face onto a new figure added to image 1. Image 2 does NOT dictate framing, pose, composition, or subject emphasis.',
          '',
          'REQUIRED OUTPUT: one photorealistic composite that is a wide or medium-wide environmental/documentary photograph of the work scene in image 1 — NOT a portrait. You MUST add exactly one NEW person to the scene whose face matches image 2. This new person is additive: keep every existing worker and all equipment from image 1, and add the new person alongside them. Total person count in the output = (persons already in image 1) + 1. If the output does not contain this new additional person with the face from image 2, the output fails.',
          '',
          'PLACEMENT OF THE NEW PERSON: they are naturally integrated into the crew, not the posed centerpiece. Mid-ground, side third (left or right, not dead-center), at a similar distance to camera as the existing workers. Head size ~10–14% of frame height — large enough for clear facial detail, still consistent with a documentary shot. Do NOT place them in the foreground as "the primary subject", do NOT make them the closest or largest figure in the frame, do NOT portrait-crop onto their face. They should look like one of the coworkers, not the star of the photo.',
        ].join('\n');

  const fallbackIntro = replace
    ? slim
      ? [
          'Portrait selfie: identity reference.',
          `On-site Boliden "${scene.label}" at industrial vehicle; match machine lighting and PPE.`,
        ].join('\n')
      : [
          'Image provided: portrait selfie — this is the face/identity reference for the person.',
          '',
          `Produce one photorealistic on-site photograph of that person in a Boliden "${scene.label}" situation: at an industrial vehicle in an underground mine, taking the place of a colleague in that pose. Match machine lighting, hi-vis PPE, and hard hat with headlamp.`,
        ].join('\n')
    : slim
      ? [
          'Portrait selfie: identity reference.',
          `Photoreal on-site photo — Boliden "${scene.label}"; colleague snapshot look.`,
        ].join('\n')
      : [
          'Image provided: portrait selfie — this is the face/identity reference for the person.',
          '',
          `Produce one photorealistic on-site photograph of that person working in a Boliden "${scene.label}" environment. The result should look like a colleague took this photo of them at work.`,
        ].join('\n');

  const prompt = [
    intro,
    identityComposite,
    buildSceneIntegrationBlock(scene, true, blockOpts),
    buildVisualIntegrationBlock(true, blockOpts),
    buildConstraintsBlock(true, scene, blockOpts),
    compositeSuffix,
  ]
    .filter(Boolean)
    .join('\n\n');

  const fallbackPrompt = [
    fallbackIntro,
    identityFallback,
    buildSceneIntegrationBlock(scene, false, blockOpts),
    buildVisualIntegrationBlock(false, blockOpts),
    buildConstraintsBlock(false, scene, blockOpts),
    fallbackSuffix,
  ]
    .filter(Boolean)
    .join('\n\n');

  return { prompt, fallbackPrompt };
}
