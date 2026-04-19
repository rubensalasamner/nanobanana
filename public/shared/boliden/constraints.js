// Negative-constraint block shared by every Boliden prompt variant.

export function buildConstraintsBlock(hasSceneImage, scene) {
  const replace = scene?.replaceReferenceSubject === true;
  const mustNots = [
    'invent new facial features or reshape the face geometry to match the scene',
    'stylize or cartoonify the face',
    'add text, watermarks, or logos',
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
