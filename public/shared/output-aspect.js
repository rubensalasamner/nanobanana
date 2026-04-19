export const OUTPUT_ASPECT_DEFAULT_ID = '1:1';

const SQUARE_QUALITY_SUFFIX =
  '\n\nRedraw the content from image 1 in a 1:1 square aspect ratio. Adjust image 1 by adding content as needed to fill a perfect square (1:1) format. Make sure no blank areas are left. Generate a high-quality, detailed, sharp focus image suitable for 300dpi printing.';

const PORTRAIT_QUALITY_SUFFIX =
  '\n\nRedraw the content from image 1 in a 3:4 portrait aspect ratio (taller than wide). Adjust image 1 by adding content as needed to fill the frame without blank areas. Generate a high-quality, detailed, sharp focus image suitable for 300dpi printing.';

const LANDSCAPE_QUALITY_SUFFIX =
  '\n\nRedraw the content from image 1 in a 16:9 landscape aspect ratio (wider than tall). Adjust image 1 by adding content as needed to fill the frame without blank areas. Generate a high-quality, detailed, sharp focus image suitable for 300dpi printing.';

function buildCompositeQualitySuffix(aspectLabel) {
  return `\n\nPreserve the full composition, framing, and visible environmental details of image 1 (the scene reference). Do not crop image 1. Output at a ${aspectLabel} aspect ratio — if the target ratio does not match image 1, outpaint/extend image 1 outward rather than cropping inward; no blank areas. Generate a high-quality, detailed, sharp focus image.`;
}

export const OUTPUT_ASPECTS = Object.freeze({
  '1:1': Object.freeze({
    id: '1:1',
    geminiAspectRatio: '1:1',
    exportWidth: 1800,
    exportHeight: 1800,
    uploadWidth: 1800,
    uploadHeight: 1800,
    qualitySuffix: SQUARE_QUALITY_SUFFIX,
    compositeQualitySuffix: buildCompositeQualitySuffix('1:1 square'),
  }),
  '3:4': Object.freeze({
    id: '3:4',
    geminiAspectRatio: '3:4',
    exportWidth: 1800,
    exportHeight: 2400,
    uploadWidth: 1800,
    uploadHeight: 2400,
    qualitySuffix: PORTRAIT_QUALITY_SUFFIX,
    compositeQualitySuffix: buildCompositeQualitySuffix('3:4 portrait'),
  }),
  '16:9': Object.freeze({
    id: '16:9',
    geminiAspectRatio: '16:9',
    exportWidth: 2560,
    exportHeight: 1440,
    uploadWidth: 2560,
    uploadHeight: 1440,
    qualitySuffix: LANDSCAPE_QUALITY_SUFFIX,
    compositeQualitySuffix: buildCompositeQualitySuffix('16:9 landscape'),
  }),
});

export function resolveOutputAspectId(raw) {
  let s = String(raw ?? '').trim().toLowerCase();
  if (!s) return OUTPUT_ASPECT_DEFAULT_ID;
  if (s === 'portrait') return '3:4';
  if (s === 'square') return '1:1';
  if (s === 'landscape') return '16:9';
  s = s.replace(/x/g, ':').replace(/\//g, ':');
  if (OUTPUT_ASPECTS[s]) return s;
  return OUTPUT_ASPECT_DEFAULT_ID;
}

export function getOutputAspectPreset(rawOrId) {
  const id = OUTPUT_ASPECTS[rawOrId] ? rawOrId : resolveOutputAspectId(rawOrId);
  return OUTPUT_ASPECTS[id];
}
