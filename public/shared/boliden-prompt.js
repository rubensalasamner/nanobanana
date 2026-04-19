import { BOLIDEN_SCENE_LIBRARY, COMPANY_IDS } from './company-scenes.js';

export function buildIdentityLockBlock(personBrief) {
  const lines = ['IDENTITY LOCK (must keep exactly, do not average, do not stylize):'];
  if (personBrief) lines.push(personBrief);
  lines.push(
    "Keep the exact same face from image 1: same eye shape and color, same nose, same jawline, same mouth, same skin tone, same hair. Relight only — do not alter facial geometry, proportions, or identity. Match the scene's ambient light and color temperature on the preserved face."
  );
  return lines.join('\n');
}

export function buildSceneIntegrationBlock(scene, hasSceneImage) {
  const sceneHint = (scene.promptHint || '').trim();
  const parts = ['SCENE INTEGRATION:'];
  if (sceneHint) parts.push(sceneHint);
  parts.push(
    'Render the person as a full-body figure, natural ~1:7 head-to-body ratio, clearly visible, facing the camera.'
  );
  parts.push(
    `Add standard PPE on top of the person's existing look: ${scene.ppeHint} PPE is added as equipment — it must not change the face.`
  );
  if (hasSceneImage) {
    parts.push(
      'Place the person naturally within the environment shown in image 2 with matching perspective, scale, and lighting direction.'
    );
  }
  return parts.join(' ');
}

export function buildConstraintsBlock(hasSceneImage) {
  const mustNots = [
    'invent new facial features',
    'stylize or cartoonify the face',
    'add text, watermarks, or logos',
  ];
  if (hasSceneImage) {
    mustNots.unshift('swap, edit, or regenerate any existing face in image 2');
    mustNots.unshift('modify image 2');
  }
  return `MUST NOT: ${mustNots.join('; ')}.`;
}

export function buildBolidenPrompt(scene, personBrief, qualitySuffix) {
  const identity = buildIdentityLockBlock(personBrief);
  const trimmedSuffix = (qualitySuffix || '').trim();

  const intro = [
    'Image 1: portrait selfie — this is the identity reference for the person.',
    `Image 2: reference photograph of the Boliden "${scene.label}" work environment.`,
    '',
    'Produce one photorealistic composite image. Treat image 2 as the background. Add the person from image 1 as a new on-site worker inside that environment. The result should look like a colleague took this photo of them at work.',
  ].join('\n');

  const fallbackIntro = [
    'Image 1: portrait selfie — this is the identity reference for the person.',
    '',
    `Produce one photorealistic on-site photograph of the person from image 1 working in a Boliden "${scene.label}" environment. The result should look like a colleague took this photo of them at work.`,
  ].join('\n');

  const prompt = [
    intro,
    identity,
    buildSceneIntegrationBlock(scene, true),
    buildConstraintsBlock(true),
    trimmedSuffix,
  ]
    .filter(Boolean)
    .join('\n\n');

  const fallbackPrompt = [
    fallbackIntro,
    identity,
    buildSceneIntegrationBlock(scene, false),
    buildConstraintsBlock(false),
    trimmedSuffix,
  ]
    .filter(Boolean)
    .join('\n\n');

  return { prompt, fallbackPrompt };
}

export function resolveGenerationStrategy({
  company,
  originalPrompt,
  sceneId,
  personBrief,
  qualitySuffix,
}) {
  if (company === COMPANY_IDS.BOLIDEN) {
    const scene = sceneId ? BOLIDEN_SCENE_LIBRARY[sceneId] : null;
    if (scene) {
      const { prompt, fallbackPrompt } = buildBolidenPrompt(scene, personBrief, qualitySuffix);
      return { prompt, fallbackPrompt, scene };
    }
  }
  const prompt = `${originalPrompt}${qualitySuffix}`;
  return { prompt, fallbackPrompt: prompt, scene: null };
}

const IDENTITY_BRIEF_INSTRUCTIONS = [
  'Look at the person in this selfie and produce a concise identity brief.',
  'Respond with exactly these labeled lines, one per line, nothing else:',
  '',
  'Hair: <color, length, texture, style>',
  'Face: <overall face shape>',
  'Eyes: <color and shape; eyebrow color and shape>',
  'Nose: <shape and size>',
  'Mouth: <lip shape and fullness>',
  'Skin: <tone and notable complexion traits>',
  'Age: <approximate age range>',
  'Distinctive: <glasses, facial hair, freckles, moles, piercings, visible tattoos, scars; or "none">',
  '',
  'Be objective and specific. Do not mention clothing, background, pose, or expression.',
].join('\n');

export async function describePersonAppearance({ ai, fileMime, fileBuf, onSuccess, onEmpty, onError }) {
  try {
    const resp = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { text: IDENTITY_BRIEF_INSTRUCTIONS },
        { inlineData: { mimeType: fileMime || 'image/jpeg', data: fileBuf.toString('base64') } },
      ],
    });
    const text = resp?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text) {
      onSuccess?.(text);
      return text;
    }
    onEmpty?.();
    return null;
  } catch (err) {
    onError?.(err);
    return null;
  }
}
