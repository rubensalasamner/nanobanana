export const COMPANY_IDS = Object.freeze({
  DEFAULT: 'default',
  BOLIDEN: 'boliden',
});

const BOLIDEN_SCENE_DATA = [
  {
    id: 'underground-drill',
    label: 'Underground drilling',
    imagePath: 'assets/images/boliden/drilling-at-zinkgruvan.jpeg',
    ppeHint: 'Hard hat with mounted lamp, reflective yellow safety jacket, work gloves.',
    promptHint:
      'The scene is an underground mine with harsh artificial work-lights and dark rock walls. The photograph should look like it was taken in this low-light environment — all skin tones, shadows, and highlights should match the underground lighting naturally.',
  },
  {
    id: 'tunnel-shift',
    label: 'Tunnel shift',
    imagePath: 'assets/images/boliden/mining-raw.jpg',
    ppeHint: 'Helmet, high-visibility outerwear, utility belt, rugged boots.',
    promptHint:
      'The scene is an underground tunnel with industrial lighting. The photograph should look like it was taken in this environment — all skin tones and shadows should match the tunnel lighting.',
  },
  {
    id: 'vehicle-in-the-mine',
    label: 'Vehicle in the mine',
    imagePath: 'assets/images/boliden/vehicle-mine.jpeg',
    ppeHint: 'Industrial PPE matching underground mine operations, keep high-visibility details.',
    promptHint:
      'The scene is an underground mine near heavy machinery with work-lights. The photograph should look like it was taken in this environment.',
  },
  {
    id: 'water-samples',
    label: 'Water samples',
    imagePath: 'assets/images/boliden/water-samples.jpeg',
    ppeHint:
      'High-visibility jacket with reflective stripes, helmet/hard hat (with headlamp if present), safety glasses, gloves, sturdy work boots.',
    promptHint:
      'The scene is outdoors by a lake in overcast daylight. The person should be standing on the shoreline near the sampling activity, without blocking the existing worker or equipment.',
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
