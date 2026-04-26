// Shared crop / composite helpers for region-scoped image edits.
//
// The face-swap pipeline does two things that need this primitive:
//   1. Targeted face-swap (api/targetedFaceSwap.js): crop the newly-added
//      face out of the Pass 1 composite, run Replicate face-swap on just
//      that crop, paste the result back with a feathered alpha edge so the
//      seam is invisible.
//   2. Region-scoped restoration (api/faceRestore.js when given a cropRect):
//      crop the same region, run CodeFormer on it only, paste it back. This
//      is what stops CodeFormer from also "restoring" every other face in
//      the scene — which manifests as visible artifacts on existing workers
//      in multi-person Boliden scenes (water-samples, coffee-break,
//      meeting-at-the-mill).
//
// The two callers used to inline the same sharp pipeline. Centralising it
// here keeps the feathering, masking, and resize-to-fill behaviour identical
// between swap and restore so the seams line up exactly.

import sharp from 'sharp';

const DEFAULT_FEATHER_FACTOR = 0.04;
const DEFAULT_MIN_FEATHER_PX = 4;

/**
 * @typedef {{ left:number, top:number, width:number, height:number }} CropRect
 */

/**
 * Extracts a rectangular region from `image` and returns it as a PNG buffer.
 * The PNG re-encode is intentional: every downstream caller (Replicate's
 * face-swap and CodeFormer wrappers) re-decodes the buffer anyway, and PNG
 * preserves the exact pixels we cropped.
 *
 * @param {object} args
 * @param {{mime:string,buf:Buffer}} args.image
 * @param {CropRect} args.cropRect
 * @returns {Promise<Buffer>}
 */
export async function extractCrop({ image, cropRect }) {
  if (!image?.buf) throw new Error('extractCrop: missing image buffer');
  if (!isValidCropRect(cropRect)) {
    throw new Error(`extractCrop: invalid cropRect ${JSON.stringify(cropRect)}`);
  }
  return sharp(image.buf).extract(cropRect).png().toBuffer();
}

/**
 * Resizes `replacement` to cropRect dims, applies a feathered alpha mask,
 * and composites it onto `base` at (cropRect.left, cropRect.top). Returns a
 * PNG buffer. The feather hides any tone/contrast jump at the crop boundary
 * — both Replicate face-swap and CodeFormer can shift the region's overall
 * colour balance slightly, which without feathering reads as a hard rectangle.
 *
 * @param {object} args
 * @param {{mime:string,buf:Buffer}} args.base
 * @param {Buffer} args.replacement
 * @param {CropRect} args.cropRect
 * @param {number} [args.featherFactor]   - fraction of min(width,height)
 * @param {number} [args.minFeatherPx]    - lower bound in pixels
 * @returns {Promise<Buffer>}
 */
export async function compositeIntoRegion({
  base,
  replacement,
  cropRect,
  featherFactor = DEFAULT_FEATHER_FACTOR,
  minFeatherPx = DEFAULT_MIN_FEATHER_PX,
}) {
  if (!base?.buf) throw new Error('compositeIntoRegion: missing base buffer');
  if (!Buffer.isBuffer(replacement)) {
    throw new Error('compositeIntoRegion: replacement must be a Buffer');
  }
  if (!isValidCropRect(cropRect)) {
    throw new Error(
      `compositeIntoRegion: invalid cropRect ${JSON.stringify(cropRect)}`
    );
  }

  const featherPx = Math.max(
    minFeatherPx,
    Math.round(Math.min(cropRect.width, cropRect.height) * featherFactor)
  );

  const resized = await sharp(replacement)
    .resize(cropRect.width, cropRect.height, { fit: 'fill' })
    .toBuffer();

  const mask = await makeFeatherMask(cropRect.width, cropRect.height, featherPx);

  const masked = await sharp(resized)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  return sharp(base.buf)
    .composite([{ input: masked, left: cropRect.left, top: cropRect.top }])
    .png()
    .toBuffer();
}

/**
 * @param {unknown} cropRect
 * @returns {boolean}
 */
export function isValidCropRect(cropRect) {
  if (!cropRect || typeof cropRect !== 'object') return false;
  const { left, top, width, height } = /** @type {CropRect} */ (cropRect);
  return (
    Number.isFinite(left) &&
    Number.isFinite(top) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    left >= 0 &&
    top >= 0 &&
    width > 0 &&
    height > 0
  );
}

async function makeFeatherMask(width, height, featherPx) {
  const inset = Math.max(1, Math.floor(featherPx));
  const innerW = Math.max(1, width - 2 * inset);
  const innerH = Math.max(1, height - 2 * inset);
  const svg = `<svg width="${width}" height="${height}"><rect x="${inset}" y="${inset}" width="${innerW}" height="${innerH}" fill="white"/></svg>`;
  return sharp(Buffer.from(svg)).blur(featherPx).greyscale().png().toBuffer();
}
