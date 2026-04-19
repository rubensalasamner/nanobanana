// Negative-constraint block shared by every Boliden prompt variant.

export function buildConstraintsBlock(hasSceneImage, scene, options = {}) {
  const { slim = false } = options;
  const replace = scene?.replaceReferenceSubject === true;
  const allowVisitorLabel = hasSceneImage && !replace;

  if (slim && hasSceneImage && !replace) {
    return `MUST NOT: return an output that is essentially the same as image 1 with no added worker; omit the new person; remove, swap, or regenerate any existing worker in image 1; use image 2 for framing, pose, or composition; center the new person, portrait-crop them, or make them the foreground primary subject; produce a half-body or close-up shot of the new person; leave selfie studio/indoor lighting on the face while the body is scene-lit — face and body must share one consistent lighting environment; leave the person visibly pasted or cut-out (no halo, no hard silhouette, no mismatched grain between face and body); add text, watermarks, or logos (EXCEPT the allowed visitor patch text "BESÖKARE" on the added new person’s jacket/shirt).`;
  }
  if (slim && hasSceneImage && replace) {
    return 'MUST NOT: leave original coworker identity visible; rearrange machine/cab/background; invent face geometry; add logos.';
  }
  if (slim && !hasSceneImage) {
    return 'MUST NOT: invent facial features; add logos; stylize the face; paste studio lighting on a scene-lit body.';
  }

  const mustNots = [
    'invent new facial features or reshape the face geometry to match the scene',
    'stylize or cartoonify the face',
    allowVisitorLabel
      ? 'add text, watermarks, or logos (EXCEPT the allowed visitor patch text "BESÖKARE" on the added new person’s jacket/shirt)'
      : 'add text, watermarks, or logos',
    'keep the selfie\'s original studio/indoor lighting on the face while the body is scene-lit — face and body must share one consistent lighting environment',
    'leave the person visibly pasted, cut-out, or composited — no hard silhouette, no halo, no mismatched grain between face and body',
  ];
  if (hasSceneImage && !replace) {
    mustNots.push('omit the new person — they MUST appear in the output');
    mustNots.push('remove, replace, or relocate any existing worker from image 1');
    mustNots.push('treat image 2 as a framing, composition, pose, or subject reference — image 2 is only a face reference');
    mustNots.push('produce a portrait, half-body shot, or close-up of the new person');
    mustNots.push('center the new person in the frame');
    mustNots.push('make the new person the largest, closest, or most prominent figure');
    mustNots.push('swap, edit, or regenerate any existing face in image 1');
  }
  if (hasSceneImage && replace) {
    mustNots.unshift('leave any part of the original coworker’s face, hair, or identity visible');
    mustNots.unshift('rearrange or replace the machine, cab, door, hoses, or background rock');
  }
  return `MUST NOT: ${mustNots.join('; ')}.`;
}
