export const COMPANY_IDS = Object.freeze({
  DEFAULT: 'default',
  BOLIDEN: 'boliden',
});

const BOLIDEN_SCENE_DATA = [
  {
    id: 'underground-drill',
    label: 'Underground drilling',
    hidden: true,
    imagePath: 'assets/images/boliden/prompt-backgrounds/drilling-at-zinkgruvan.jpeg',
    nativeAspect: '16:9',
    ppeHint: 'Hard hat with mounted lamp, reflective yellow safety jacket, work gloves.',
    promptHint:
      'The scene is an underground mine with harsh artificial work-lights and dark rock walls. The photograph should look like it was taken in this low-light environment — all skin tones, shadows, and highlights should match the underground lighting naturally.',
    placementHint:
      'Place the new person standing on the left side of the tunnel in the background, against the rock wall behind the existing crouched worker and the drill rig. They observe the work from a short distance, never in front of the existing worker and never obstructing the drill equipment.',
  },
  {
    id: 'zinkgruvan-tailings-pond',
    label: 'Zinkgruvan by the tailings pond',
    imagePath:
      'assets/images/boliden/prompt-backgrounds/zinkgruvan-by-the-tailings-pond.jpeg',
    nativeAspect: '16:9',
    ppeHint:
      'Neon hi-vis jacket and navy trousers with silver reflective stripes, hard hat with ear protection, safety glasses, gloves if others wear them — match the crew.',
    promptHint:
      'Outdoor site at Zinkgruvan beside a tailings pond: sand and gravel foreground, large pipe behind the workers, flat water and grey sky in the distance. Soft overcast daylight — skin tones and shadows must match that flat outdoor light.',
    placementHint:
      'Place the new person standing or crouched on the sand or gravel to the left or right third of the frame, clearly beside the existing pair and their sampling setup — same scale, never blocking the pipe, the pond horizon, or the equipment between the two workers.',
  },
  {
    id: 'vehicle-in-the-mine',
    label: 'Vehicle in the mine',
    imagePath: 'assets/images/boliden/prompt-backgrounds/vehicle-mine.jpeg',
    nativeAspect: '16:9',
    ppeHint: 'Industrial PPE matching underground mine operations, keep high-visibility details.',
    promptHint:
      'The scene is an underground mine near heavy machinery with work-lights. The photograph should look like it was taken in this environment.',
    placementHint:
      'Place the new person beside or slightly behind the vehicle, in the mid-ground, to the left or right side of the frame — never in front of the vehicle and never blocking the camera\'s view of the machinery. Match the scale of any existing workers already visible.',
  },
  {
    id: 'coworker-with-machine',
    label: 'Coworker with machine',
    hidden: true,
    imagePath: 'assets/images/boliden/prompt-backgrounds/coworker-with-machine.jpeg',
    nativeAspect: '16:9',
    replaceReferenceSubject: true,
    // hair.length is the target person's hair length in this image. The
    // face-swap-only strategy compares it against the selfie's parsed hair
    // length and falls back to two-pass on a strict short↔long clash —
    // InsightFace doesn't move hair, so a long-haired selfie onto this
    // short-haired body would keep the body's hair and read wrong.
    primaryFace: { strategy: 'swap-only', hair: { length: 'short' } },
    ppeHint:
      'Neon hi-vis shirt with reflective stripes, hard hat with headlamp, safety glasses, ear protection, chin strap — match what is visible in the reference.',
    promptHint:
      'Underground mine beside a yellow industrial vehicle with bright work-lights and dark rock. Harsh mixed lighting from machine LEDs and the headlamp — skin tones and shadows must match that environment.',
  },
  {
    id: 'coworker-with-measuring-instrument',
    label: 'Coworker with measuring instrument',
    hidden: true,
    imagePath:
      'assets/images/boliden/prompt-backgrounds/coworker-with-measuring-instrument.jpeg',
    nativeAspect: '16:9',
    replaceReferenceSubject: true,
    primaryFace: { strategy: 'swap-only', hair: { length: 'long' } },
    ppeHint:
      'Neon hi-vis jacket with reflective stripes, hard hat (with ear protection and chin strap if present), safety glasses — match what is visible in the reference.',
    promptHint:
      'Outdoor lakeside setting in overcast daylight. Keep natural subdued lighting and soft shadows; skin tones and highlights must match cloudy daylight. Keep the survey/measuring instrument and tripod exactly as in the reference.',
  },
  {
    id: 'water-samples',
    label: 'Water samples',
    imagePath: 'assets/images/boliden/prompt-backgrounds/water-samples.jpeg',
    nativeAspect: '16:9',
    ppeHint:
      'High-visibility jacket with reflective stripes, helmet/hard hat (with headlamp if present), safety glasses, gloves, sturdy work boots.',
    promptHint:
      'The scene is outdoors by a lake in overcast daylight. The person should be standing on the shoreline near the sampling activity, without blocking the existing worker or equipment.',
    placementHint:
      'Place the new person on the shoreline on the left or right third of the frame, clearly beside or slightly behind the existing workers already sampling water — at matching scale and depth, never closer to the camera than them, never larger than them in frame.',
  },
  {
    id: 'coffee-break',
    label: 'Coffee break',
    imagePath: 'assets/images/boliden/prompt-backgrounds/coffee-break.jpeg',
    nativeAspect: '16:9',
    ppeHint:
      'Neon high-visibility jacket and trousers with navy panels and silver reflective stripes, yellow hard hat with headlamp if others wear one, work boots, radio on belt — match the crew.',
    promptHint:
      'The scene is an indoor mine-site canteen or break room: bright cool fluorescent light, white walls, utilitarian tables and chairs. The photograph should feel like a candid work break — relaxed, social, same lighting on faces and gear as the rest of the room.',
    placementHint:
      'Place the new person at a table or standing beside one in the mid-ground, left or right of centre — with coworkers at similar scale, never blocking the main group at the table and never unnaturally large in frame.',
  },
  {
    id: 'meeting-at-the-mill',
    label: 'Meeting at the mill',
    imagePath: 'assets/images/boliden/prompt-backgrounds/Meeting at the mill.jpeg',
    nativeAspect: '16:9',
    ppeHint:
      'Full hi-vis coveralls or jacket and trousers with reflective stripes, yellow hard hat with ear protection, safety glasses, gloves — match the crew on the platform.',
    promptHint:
      'Large indoor mill or processing plant: metal gratings, yellow guardrails, overhead pipes and machinery, bright industrial lighting. Skin tones and shadows must match that environment — documentary crew discussion, not a portrait.',
    placementHint:
      'Place the new person on the same raised platform as the group, toward the left or right edge of the frame (not in the centre of the huddle), at the same depth and scale as the existing workers — part of the meeting, never blocking the crane sign or the main group.',
  },
];

export const BOLIDEN_SCENES = Object.freeze(
  BOLIDEN_SCENE_DATA.map((scene) => Object.freeze({ ...scene }))
);

export const BOLIDEN_SCENE_LIBRARY = Object.freeze(
  Object.fromEntries(BOLIDEN_SCENES.map((scene) => [scene.id, scene]))
);

export function resolveCompany(rawCompany) {
  return rawCompany === COMPANY_IDS.BOLIDEN ? COMPANY_IDS.BOLIDEN : COMPANY_IDS.DEFAULT;
}
