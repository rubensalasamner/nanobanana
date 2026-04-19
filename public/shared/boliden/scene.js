// Scene integration blocks: where the person goes in the frame, and how they blend.

export function buildVisualIntegrationBlock(hasSceneImage, options = {}) {
  const { slim = false } = options;
  if (!hasSceneImage) {
    return slim
      ? 'VISUAL: Directional light, shadows, grain, and exposure like an on-site photo — not pasted.'
      : 'VISUAL INTEGRATION: Light the person with realistic directional lighting consistent with the described environment — visible key-light direction, cast shadows, matching color temperature, subtle grain and exposure characteristic of an on-site photograph. The person should look photographed in the scene, not pasted onto it.';
  }
  if (slim) {
    return [
      'VISUAL INTEGRATION (new person must look photographed inside image 1, not pasted):',
      '- Key light, fill, color temperature, and exposure on face/hat/clothing match image 1. Hard light stays hard, soft fill stays soft.',
      '- Cast shadows from the person onto ground/walls/equipment consistent with image 1\'s light directions; contact shadows at feet and any surface contact.',
      '- Match image 1\'s grain, sharpness, micro-contrast, and depth-of-field falloff on the person — not crisper, not smoother.',
      '- Skin, hi-vis fabric, and PPE pick up the same dust, wear, grime, and atmospheric cast as real workers in image 1 — no factory-clean paste-in.',
      '- Silhouette edges blend naturally — no hard cutout outline, no halo, no color fringing.',
    ].join('\n');
  }
  return [
    'VISUAL INTEGRATION (the person must look photographed inside image 1, not pasted on top):',
    '- Match image 1\'s key light direction, fill, color temperature, and exposure onto the person\'s face, hat, and clothing. Hard light stays hard; soft fill stays soft.',
    '- Cast realistic shadows from the person onto the ground, walls, and nearby equipment in image 1, consistent with those light directions.',
    '- Add contact shadows where the person\'s feet, hands, or body meet surfaces in image 1.',
    '- Match image 1\'s film grain, noise, sharpness, micro-contrast, and depth-of-field falloff onto the person — no crisper, no softer.',
    '- Match the scene\'s atmosphere onto the person: visible dust, haze, humidity, rim light, or color cast picked up from nearby surfaces.',
    '- The person\'s skin, jacket, and hi-vis fabric pick up the same dust, grime, wear, and sweat as real workers in this environment — not factory-clean.',
    '- Blend the silhouette edges naturally — no hard cutout outline, no bright halo, no color fringing.',
  ].join('\n');
}

export function buildSceneIntegrationBlock(scene, hasSceneImage, options = {}) {
  const { slim = false } = options;
  const sceneHint = (scene.promptHint || '').trim();
  const placementHint = (scene.placementHint || '').trim();
  const parts = ['SCENE INTEGRATION:'];
  if (sceneHint) parts.push(sceneHint);
  const wantsVisitorLabel = hasSceneImage && scene?.replaceReferenceSubject !== true;

  if (scene.replaceReferenceSubject && hasSceneImage) {
    parts.push(
      'Image 1 shows a colleague at the machine. Replace that worker entirely with the person whose face is in image 2: adopt the same pose, stance, and interaction with the vehicle (e.g. position in the cab doorway, hand on the door). Preserve everything else in image 1: the vehicle, hoses, lights, rock walls, perspective, and framing.'
    );
    parts.push(
      'The output must contain only one person — with the face from image 2 — in that role. Relight them aggressively to match the scene headlights and headlamp; shadows and highlights must be consistent with the underground setting, not with the selfie\'s original lighting.'
    );
    parts.push(
      `Match the work clothing and PPE visible in image 1 onto the replaced person (${scene.ppeHint}). The face and identity must match image 2 — but the lighting, grain, atmosphere, and wear must match image 1.`
    );
    return parts.join(' ');
  }

  if (hasSceneImage && slim) {
    parts.push(
      'Keep everyone and everything already in image 1. ADD one additional worker (not a clone of an existing figure) — the scene must show one more person than image 1. Wide/medium-wide documentary shot; new person in side third, mid-ground, natural pose alongside the existing crew — not centered, not foreground-hero, not a portrait. Head ~10–14% of frame height.',
    );
    if (placementHint) parts.push(`Placement: ${placementHint}`);
    parts.push(
      `PPE: ${scene.ppeHint} (equipment only; do not change face shape).`
    );
    if (wantsVisitorLabel) {
      parts.push(
        'Visitor marking: add a clear fabric patch / print on the new person’s hi-vis jacket or shirt that reads exactly "BESÖKARE" (uppercase, plain block letters). This is the only text allowed.'
      );
    }
    return parts.join(' ');
  }

  if (hasSceneImage) {
    parts.push(
      'Preserve the full composition, framing, environment, and every existing worker from image 1. Do not remove, replace, or relocate any existing worker. You are ADDING one new person to the scene, not substituting anyone.'
    );
    if (placementHint) {
      parts.push(`Specific placement for this scene: ${placementHint}`);
    }
    parts.push(
      'Shot framing and placement of the new person:',
      '- The overall shot is wide or medium-wide — a documentary/reportage photograph of the work scene. It is NOT a portrait of the new person.',
      '- Horizontal position: left third or right third of the frame. Never dead-center.',
      '- Depth: mid-ground or background, beside or slightly behind existing workers/equipment in image 1. Not in the foreground, not closer to the camera than existing workers.',
      '- Relative size: match the apparent size of existing workers in image 1 — similar head size, similar body height in frame. If image 1 contains no people, the new person\'s body fills roughly one-quarter of the frame height and their head fills roughly 6–10% of the frame height.',
      '- Pose: standing or working naturally in the scene, facing the camera or turned toward the activity. Not a posed portrait.',
      '- Match perspective, eye-line, ground plane, and focal length with image 1.'
    );
  } else {
    parts.push(
      slim
        ? 'Wide documentary framing; person in side third; head ~6–10% frame height; not a portrait.'
        : 'The person stands within the scene at natural full-body proportions, positioned in the left third or right third of the frame (not dead-center). The overall shot is a wide or medium-wide documentary photograph — the person\'s body fills roughly one-quarter of the frame height and the head fills roughly 6–10% of the frame height. This is a scene photograph that includes the person, not a portrait.'
    );
  }
  parts.push(
    slim
      ? `PPE: ${scene.ppeHint} (gear only; do not change the face).`
      : `Add standard PPE on top of the person's existing look: ${scene.ppeHint} PPE is added as equipment — it must not change the face.`
  );
  if (wantsVisitorLabel) {
    parts.push(
      'Visitor marking: the added new person is a visitor. Add a clear fabric patch / print on their hi-vis jacket or shirt that reads exactly "BESÖKARE" (uppercase, plain block letters). Do not add any other text.'
    );
  }
  return parts.join(' ');
}
