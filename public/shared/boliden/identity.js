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
//
// Anti-hero history:
//   The original placeholder mode included a "Swap targeting hint" telling
//   Gemini to make the new worker's face the clearest/most prominent in the
//   frame. In practice this fought the head-size cap: Gemini would oblige
//   the prominence instruction by pulling the worker into the foreground
//   (run i62leYvO meeting-at-the-mill: faceFracH=0.22, exceeding 0.18 alarm).
//   Targeting is the bbox detector's job, not the composer's — removed.
//   The size anchor is now expressed relative to existing workers in the
//   scene instead of as a frame-height percentage; "no larger than the
//   nearest existing worker" is something the model can actually verify
//   against image 1, whereas "10–14% of frame height" turns into a soft
//   suggestion the model bends when a portrait crop would look better.
export function buildIdentityLockBlock(personBrief, hasSceneImage = true, options = {}) {
  const { faceWillBeSwapped = false, slim = false } = options;
  const faceRef = hasSceneImage ? 'image 2' : 'the provided selfie';
  const sceneRef = hasSceneImage ? 'image 1' : 'the described scene';

  if (faceWillBeSwapped && slim) {
    const lines = ['FACE (placeholder — replaced later):'];
    if (personBrief) lines.push(personBrief);
    lines.push(
      `Rough face from ${faceRef}; exact features not needed — a later step replaces it. Body, PPE, pose, and framing match ${sceneRef} naturally; the added worker is just one of the workers in the scene, not a centered or posed subject.`
    );
    lines.push(
      `Size anchor (HARD): the new worker's HEAD must be NO LARGER than the heads of the existing workers visible in ${sceneRef}. Match their depth — same plane or slightly behind, never in front. If you would otherwise make the head larger than any existing head in ${sceneRef}, place the new worker further from the camera until the heads match. No portrait crop, no close-up, no hero subject. Cap: head ≤ 12% of total frame height regardless. Head-to-body proportion stays anatomical (head ~1/7 of standing body height).`
    );
    lines.push(
      `Face must be a clean swap target: 3/4 or frontal to camera (not profile), unoccluded — no helmet brim shadowing the eyes, no hand/mug/tool across the face, no hair or headset covering features. Eyes open, mouth neutral.`
    );
    lines.push(
      `Face lighting: face lit by ${sceneRef}'s light, not selfie lighting. Same key-light direction, color temperature, exposure, and shadow pattern as the body — helmet-brim shadow if overhead light, cool scene fill on shadowed side, matching grain and micro-contrast as the body. No plastic, smooth, or studio-lit face on a scene-lit body.`
    );
    return lines.join('\n');
  }

  if (faceWillBeSwapped) {
    const lines = ['FACE + HEAD PROPORTIONS (placeholder face — will be replaced in a later step):'];
    if (personBrief) lines.push(personBrief);
    lines.push(
      `The face from ${faceRef} is a rough placeholder. Do NOT try to copy its exact features. A later automated step will replace the face. Your job here is to produce a photographically correct body and head in the scene — proportions, pose, framing, PPE, lighting — with any roughly plausible face in the right position and size.`
    );
    lines.push(
      `Size anchor (HARD constraint, verify against ${sceneRef}): the new worker's HEAD must be NO LARGER than the heads of the existing workers in ${sceneRef}. Same depth plane as them or slightly behind — never in front, never closer to the camera. If you would otherwise render a head larger than any existing head in ${sceneRef}, push the new worker further into the scene until their head matches. Absolute cap: head ≤ 12% of total frame height regardless of scene. Head-to-body proportion stays anatomical (head ~1/7 to 1/8 of standing body height). Do NOT center the person, do NOT force them into the foreground, do NOT make them the "primary subject" or the largest/closest figure. Place them naturally alongside existing workers — side third of the frame, mid-ground, one of the crew. No portrait crop, no close-up, no hero composition.`
    );
    lines.push(
      `Face orientation and occlusion: the placeholder face is 3/4 or frontal to camera so a later face-swap has a clean target. No helmet brim shadowing across the eyes, no hand or mug or tool covering any part of the face, no hair or headset obscuring features. Eyes open, mouth neutral, no extreme expressions.`
    );
    lines.push(
      `Face lighting integration: the placeholder face MUST be lit by ${sceneRef}'s lighting, not by the selfie's original studio/indoor light. Apply the same key-light direction, key-light intensity, fill color, color temperature, exposure, contrast, and shadow placement to the face as the rest of the body receives from ${sceneRef}. If there's an overhead fluorescent above, the eye sockets and brow have a subtle shadow from the helmet brim and the nose bridge catches a specular highlight. If the scene is dimmer toward the side, the face has the same falloff. Match ${sceneRef}'s grain, micro-contrast, and softness on the face — never crisper, never smoother, never plastic-looking.`
    );
    return lines.join('\n');
  }

  if (slim) {
    const lines = ['IDENTITY + LIGHTING:'];
    if (personBrief) lines.push(personBrief);
    lines.push(
      `Match facial geometry from ${faceRef}. Relight the face from ${sceneRef} only (key, fill, grain like the scene — not selfie lighting). Head size consistent with other people in ${sceneRef} (~6–10% frame height). Identity = geometry; lighting comes from the scene.`
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

// The describe call doubles as a face-presence pre-check. Doing it here
// avoids a second Gemini round-trip (the alternative `detectFaceBbox(selfie)`
// would add ~3–5 s on every request). The model is asked to emit a leading
// `Face detected: yes|no` line; if `no`, the pipeline can return 422
// immediately and skip ~25 s of doomed Replicate face-swap attempts.
//
// Conservative semantics: only a clear, parseable `no` triggers fail-fast.
// Malformed / missing responses fall through with `faceDetected: null` and
// the pipeline proceeds normally — we don't let a flaky parse block real
// users, we just lose the early-exit optimisation for that request.
const IDENTITY_BRIEF_INSTRUCTIONS = [
  'Look at this image. First decide whether it contains a clearly visible human face suitable for face-swap (frontal or 3/4 view, eyes and primary features visible, not heavily occluded by hand/object/severe shadow).',
  '',
  'OUTPUT FORMAT — follow exactly, no extra text:',
  '',
  '1. The first line must be exactly one of:',
  '     Face detected: yes',
  '     Face detected: no',
  '',
  '2. If you wrote "Face detected: no", stop immediately. Output ONLY that single line.',
  '',
  '3. If you wrote "Face detected: yes", continue with these labeled lines, one per line, in this exact order, and nothing else:',
  '',
  '     Hair: <color, length, texture, style>',
  '     Face: <overall face shape>',
  '     Eyes: <color and shape; eyebrow color and shape>',
  '     Nose: <shape and size>',
  '     Mouth: <lip shape and fullness>',
  '     Skin: <tone and notable complexion traits>',
  '     Age: <approximate age range>',
  '     Distinctive: <glasses, facial hair, freckles, moles, piercings, visible tattoos, scars; or "none">',
  '',
  'Be objective and specific. Do not mention clothing, background, pose, or expression.',
].join('\n');

/**
 * @typedef {Object} DescribeResult
 * @property {string|null} brief        Identity brief without the verdict line, or null.
 * @property {boolean|null} faceDetected `true` / `false` from the verdict line; `null` if unparseable.
 * @property {string|null} raw          Trimmed model output as received.
 */

/**
 * Extract a coarse hair-length bucket from a person brief. Used by the
 * face-swap-only strategy gate: the underlying model (InsightFace
 * cdingram/face-swap) only swaps the FACE region, not hair. So a long-haired
 * scene + short-haired selfie produces a face-swapped output that still has
 * the original long hair, which reads as the wrong gender presentation.
 * The strategy compares the parsed length against the scene's declared
 * `primaryFace.hair.length` and falls back to two-pass on mismatch so
 * Gemini can render a body whose hair matches the selfie.
 *
 * Returns one of:
 *   - 'short'   long ≤ ear-ish (short, buzz, crew, undercut, cropped)
 *   - 'long'    past shoulders (long, waist-length, past-shoulders)
 *   - 'medium'  in-between (medium, shoulder-length, chin-length, bob)
 *   - null      no `Hair:` line, unrecognised, or bald (no length signal).
 *
 * `medium` is treated as compatible with both buckets at the call site —
 * this parser only buckets, it does not gate.
 *
 * Conservative semantics: a missing or unrecognised brief returns null,
 * which the gate must NOT treat as a mismatch. We only block when we have
 * positive evidence of a clash.
 *
 * @param {string|null|undefined} brief
 * @returns {'short'|'long'|'medium'|null}
 */
export function parseHairLength(brief) {
  if (typeof brief !== 'string') return null;
  const match = brief.match(/^\s*Hair:\s*(.+)$/im);
  if (!match) return null;
  const desc = match[1].toLowerCase();

  // Order matters: check longest-first because "shoulder-length" contains
  // "long" as a substring of nothing relevant, but "past shoulders" implies
  // long. Bald takes priority over everything (no hair = no length signal).
  if (/\b(bald|shaved head|hairless)\b/.test(desc)) return null;

  if (
    /\b(long|past[- ]shoulders?|waist[- ]length|mid[- ]back)\b/.test(desc)
  ) {
    return 'long';
  }

  if (
    /\b(short|buzz(?:ed)?|crew[- ]cut|crewcut|cropped|pixie|undercut|fade|close[- ]cropped)\b/.test(
      desc
    )
  ) {
    return 'short';
  }

  if (
    /\b(medium|shoulder[- ]length|chin[- ]length|bob|lob|mid[- ]length)\b/.test(
      desc
    )
  ) {
    return 'medium';
  }

  return null;
}

/**
 * Pure parser for the model response. Exposed so the smoke test can cover
 * the four canonical shapes (yes+brief, no, malformed, empty) without
 * needing a real Gemini round-trip.
 *
 * @param {string|null|undefined} text
 * @returns {DescribeResult}
 */
export function parseDescribeResponse(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { brief: null, faceDetected: null, raw: null };
  }
  const raw = text.trim();
  const lines = raw.split(/\r?\n/);
  const firstLine = lines[0]?.trim() || '';
  const verdict = /^Face detected:\s*(yes|no)\s*$/i.exec(firstLine);
  if (!verdict) {
    return { brief: raw, faceDetected: null, raw };
  }
  if (verdict[1].toLowerCase() === 'no') {
    return { brief: null, faceDetected: false, raw };
  }
  const brief = lines.slice(1).join('\n').trim() || null;
  return { brief, faceDetected: true, raw };
}

/**
 * @param {Object} args
 * @param {import('@google/genai').GoogleGenAI} args.ai
 * @param {string} args.fileMime
 * @param {Buffer} args.fileBuf
 * @param {(parsed: DescribeResult) => void} [args.onSuccess]
 * @param {() => void} [args.onEmpty]
 * @param {(err: unknown) => void} [args.onError]
 * @returns {Promise<DescribeResult>}
 */
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
    const parsed = parseDescribeResponse(text);
    if (parsed.raw) {
      onSuccess?.(parsed);
    } else {
      onEmpty?.();
    }
    return parsed;
  } catch (err) {
    onError?.(err);
    return { brief: null, faceDetected: null, raw: null };
  }
}
