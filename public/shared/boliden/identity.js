// Identity preservation: face-lock prompt block + GPT-powered person description.

// Face/identity block. Two modes:
//   - strict (default): the output is the final image; preserve facial geometry
//     aggressively so the face in the composite is recognizable.
//   - placeholder (faceWillBeSwapped=true): the output is an intermediate pass
//     that will have the face replaced by a dedicated face-swap step. Identity
//     precision here is wasted effort and actively fights framing/proportion
//     instructions (Gemini tends to portraitize the crop when it's told to
//     lock facial geometry). Instead, tell Gemini the face is a placeholder
//     and demand anatomically correct head-to-body proportions matching other
//     workers in the scene.
export function buildIdentityLockBlock(personBrief, hasSceneImage = true, options = {}) {
  const { faceWillBeSwapped = false } = options;
  const faceRef = hasSceneImage ? 'image 2' : 'the provided selfie';
  const sceneRef = hasSceneImage ? 'image 1' : 'the described scene';

  if (faceWillBeSwapped) {
    const lines = ['FACE + HEAD PROPORTIONS (placeholder face — will be replaced in a later step):'];
    if (personBrief) lines.push(personBrief);
    lines.push(
      `The face from ${faceRef} is a rough placeholder. Do NOT try to copy its exact features. A later automated step will replace the face. Your job here is to produce a photographically correct body and head in the scene — proportions, pose, framing, PPE, lighting — with any roughly plausible face in the right position and size.`
    );
    lines.push(
      `Head-to-body proportion is critical: the new person's head must be anatomically proportional to their own torso (approx 1/7 to 1/8 of total standing body height) AND match the apparent head size of other workers in ${sceneRef}. Do NOT enlarge the head to emphasize the face. Do NOT crop in on the face. The head occupies roughly 6–10% of the total frame height. Neck, shoulders, and torso must be visibly continuous with the head — no floating head, no mismatched scales, no portrait-crop framing.`
    );
    lines.push(
      `Face orientation and lighting: the placeholder face must be oriented naturally for the pose (typically 3/4 or frontal to camera so a later face-swap has a clean target) and lit consistently with ${sceneRef} — same key-light direction, color temperature, and exposure as the body. Eyes open, mouth neutral, no extreme expressions.`
    );
    return lines.join('\n');
  }

  const lines = ['IDENTITY + FACE LIGHTING:'];
  if (personBrief) lines.push(personBrief);
  lines.push(
    `Facial geometry: copy the face from ${faceRef} (the face reference) — same eye shape, spacing, and color; same nose shape and size; same jawline and chin; same mouth shape; same cheekbones; same forehead height; same ear shape; same hair; same apparent age; same distinctive features (glasses, facial hair, moles, scars). Bone structure, feature proportions, and the spatial relationships between features must match ${faceRef} exactly. Do not reshape, re-proportion, soften, smooth, symmetrize, beautify, idealize, or average any facial feature.`
  );
  lines.push(
    `Face lighting: the face MUST be lit by ${sceneRef}'s lighting, not the selfie's original studio/indoor lighting. Apply the same key-light direction, key-light intensity, fill color, color temperature, exposure, contrast, shadow placement, rim light, and film grain to the face as the rest of the body receives from ${sceneRef}. If the body is dimly lit from above by a headlamp in a dark tunnel, the face is lit the same way — brow shadows from the helmet, specular highlight on the nose bridge, cool shadowed cheeks. If the body is in overcast daylight, the face has the same flat cool daylight on it. Face lighting and body lighting come from one consistent source — ${sceneRef}.`
  );
  lines.push(
    `Head/body proportion: the new person's head must be anatomically proportional to their torso and match the head-size of other workers in ${sceneRef}. The head occupies roughly 6–10% of the total frame height. Do not enlarge the head or crop in on the face.`
  );
  lines.push(
    `Recognizability test: a viewer who knows the person in ${faceRef} must still immediately identify them in the output, even after the face is fully relit by ${sceneRef}. Identity is encoded in geometry; lighting is independent of identity. Relight aggressively; reshape never.`
  );
  return lines.join('\n');
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
