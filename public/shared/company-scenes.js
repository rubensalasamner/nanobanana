export const COMPANY_IDS = Object.freeze({
  DEFAULT: 'default',
  BOLIDEN: 'boliden',
});

const BOLIDEN_SCENE_DATA = [
  {
    id: 'underground-drill',
    label: 'Underground drilling',
    imagePath: 'assets/images/boliden/underground-drill.jpg',
    ppeHint: 'Hard hat with mounted lamp, reflective yellow safety jacket, work gloves.',
  },
  {
    id: 'mine-inspection',
    label: 'Mine inspection',
    imagePath: 'assets/images/boliden/mine-inspection.jpg',
    ppeHint: 'Safety helmet, reflective vest, protective eyewear, steel-toe workwear.',
  },
  {
    id: 'tunnel-shift',
    label: 'Tunnel shift',
    imagePath: 'assets/images/boliden/mining-raw.jpg',
    ppeHint: 'Helmet, high-visibility outerwear, utility belt, rugged boots.',
  },
  {
    id: 'site-overview',
    label: 'Site overview',
    imagePath: 'assets/images/boliden/site-overview.jpg',
    ppeHint: 'Industrial PPE matching workers in the scene, keep high-visibility details.',
  },
  {
    id: 'vehicle-in-the-mine',
    label: 'Vehicle in the mine',
    imagePath: 'assets/images/boliden/vehicle-mine.jpeg',
    ppeHint: 'Industrial PPE matching underground mine operations, keep high-visibility details.',
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
