export const OUTPUT_ASPECT_DEFAULT_ID = '1:1';

const SQUARE_QUALITY_SUFFIX =
  '\n\nRedraw the content from image 1 in a 1:1 square aspect ratio. Adjust image 1 by adding content as needed to fill a perfect square (1:1) format. Make sure no blank areas are left. Generate a high-quality, detailed, sharp focus image suitable for 300dpi printing.';

const PORTRAIT_QUALITY_SUFFIX =
  '\n\nRedraw the content from image 1 in a 3:4 portrait aspect ratio (taller than wide). Adjust image 1 by adding content as needed to fill the frame without blank areas. Generate a high-quality, detailed, sharp focus image suitable for 300dpi printing.';

export const OUTPUT_ASPECTS = Object.freeze({
  '1:1': Object.freeze({
    id: '1:1',
    geminiAspectRatio: '1:1',
    exportWidth: 1800,
    exportHeight: 1800,
    uploadWidth: 1800,
    uploadHeight: 1800,
    qualitySuffix: SQUARE_QUALITY_SUFFIX,
  }),
  '3:4': Object.freeze({
    id: '3:4',
    geminiAspectRatio: '3:4',
    exportWidth: 1800,
    exportHeight: 2400,
    uploadWidth: 1800,
    uploadHeight: 2400,
    qualitySuffix: PORTRAIT_QUALITY_SUFFIX,
  }),
});

export function resolveOutputAspectId(raw) {
  let s = String(raw ?? '').trim().toLowerCase();
  if (!s) return OUTPUT_ASPECT_DEFAULT_ID;
  if (s === 'portrait') return '3:4';
  if (s === 'square') return '1:1';
  s = s.replace(/x/g, ':').replace(/\//g, ':');
  if (s === '3:4') return '3:4';
  if (s === '1:1') return '1:1';
  return OUTPUT_ASPECT_DEFAULT_ID;
}

export function getOutputAspectPreset(rawOrId) {
  const id = OUTPUT_ASPECTS[rawOrId] ? rawOrId : resolveOutputAspectId(rawOrId);
  return OUTPUT_ASPECTS[id];
}
