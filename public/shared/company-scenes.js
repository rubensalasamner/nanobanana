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
      'Underground mine with harsh artificial work-lights and dark rock walls. Adapt the inserted person\'s skin tones, shadows, and highlights to this dark, directionally-lit environment — do not keep the selfie\'s original bright lighting on the face.',
  },
  {
    id: 'tunnel-shift',
    label: 'Tunnel shift',
    imagePath: 'assets/images/boliden/mining-raw.jpg',
    ppeHint: 'Helmet, high-visibility outerwear, utility belt, rugged boots.',
    promptHint:
      'Underground tunnel with industrial lighting. Adapt the inserted person\'s skin tones and shadows to this dark, artificially-lit environment.',
  },
  {
    id: 'vehicle-in-the-mine',
    label: 'Vehicle in the mine',
    imagePath: 'assets/images/boliden/vehicle-mine.jpeg',
    ppeHint: 'Industrial PPE matching underground mine operations, keep high-visibility details.',
    promptHint:
      'Underground mine near heavy machinery with work-lights. Adapt the inserted person\'s skin tones and shadows to this dark, artificially-lit environment.',
  },
  {
    id: 'water-samples',
    label: 'Water samples',
    imagePath: 'assets/images/boliden/water-samples.jpeg',
    ppeHint:
      'High-visibility jacket with reflective stripes, helmet/hard hat (with headlamp if present), safety glasses, gloves, sturdy work boots.',
    promptHint:
      'Outdoors by a lake in overcast daylight. Place the inserted worker on the shoreline near the sampling activity, but do not block the existing worker or equipment.',
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
