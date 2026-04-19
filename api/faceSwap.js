// Hosted face-swap wrapper used by the two-pass Boliden strategy.
//
// Uses Replicate's cdingram/face-swap (InsightFace-based). The model takes a
// target `input_image` (where the face goes) and a source `swap_image` (where
// the face comes from), and returns a URL to the swapped image.
//
// Graceful degradation: if REPLICATE_API_TOKEN is missing, or the call fails,
// or the model returns nothing, this returns null so callers can fall back to
// the pre-swap image.

import Replicate from 'replicate';

const DEFAULT_FACE_SWAP_MODEL =
  'cdingram/face-swap:d1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111';

export function isFaceSwapAvailable() {
  return Boolean(process.env.REPLICATE_API_TOKEN);
}

function toDataUri({ mime, buf }) {
  const safeMime = mime || 'image/jpeg';
  return `data:${safeMime};base64,${buf.toString('base64')}`;
}

// Replicate v1.x can return the model output in several shapes:
//   - a string URL (older models or legacy behavior)
//   - an array of the above
//   - a FileOutput object (extends ReadableStream, has .url()/.blob())
//   - an array of FileOutput objects
// Normalize all of these into a single { mime, buf } image.
async function fetchOutputAsBuffer(output) {
  const first = Array.isArray(output) ? output[0] : output;
  if (first == null) return null;

  if (typeof first.blob === 'function') {
    const blob = await first.blob();
    const mime = blob.type || 'image/jpeg';
    const buf = Buffer.from(await blob.arrayBuffer());
    return { mime, buf };
  }

  let url = null;
  if (typeof first === 'string') url = first;
  else if (typeof first.url === 'function') {
    const u = first.url();
    url = typeof u === 'string' ? u : u?.toString?.();
  } else if (first.url && typeof first.url.toString === 'function') {
    url = first.url.toString();
  }

  if (!url || typeof url !== 'string') return null;

  const r = await fetch(url);
  if (!r.ok) {
    const err = new Error(`face-swap output fetch failed: HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const mime = r.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await r.arrayBuffer());
  return { mime, buf };
}

export async function swapFace({ targetImage, sourceFace, reqId, log, modelRef }) {
  if (!isFaceSwapAvailable()) {
    log?.(reqId, 'warn', 'faceSwap.skip.noToken');
    return null;
  }
  if (!targetImage?.buf || !sourceFace?.buf) {
    log?.(reqId, 'warn', 'faceSwap.skip.missingInputs', {
      hasTarget: Boolean(targetImage?.buf),
      hasSource: Boolean(sourceFace?.buf),
    });
    return null;
  }

  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  const model = modelRef || process.env.REPLICATE_FACE_SWAP_MODEL || DEFAULT_FACE_SWAP_MODEL;
  const input = {
    input_image: toDataUri(targetImage),
    swap_image: toDataUri(sourceFace),
  };

  const start = Date.now();
  try {
    const output = await replicate.run(model, { input });
    const result = await fetchOutputAsBuffer(output);
    if (!result) {
      log?.(reqId, 'warn', 'faceSwap.noOutput', {
        ms: Date.now() - start,
        outputType: Array.isArray(output) ? 'array' : typeof output,
        outputLength: Array.isArray(output) ? output.length : undefined,
        firstItemType: Array.isArray(output) ? typeof output[0] : undefined,
        firstItemCtor:
          Array.isArray(output) && output[0]
            ? output[0]?.constructor?.name
            : output?.constructor?.name,
      });
      return null;
    }
    log?.(reqId, 'log', 'faceSwap.ok', {
      ms: Date.now() - start,
      outBytes: result.buf.length,
      outMime: result.mime,
    });
    return result;
  } catch (err) {
    log?.(reqId, 'error', 'faceSwap.fail', {
      message: err?.message,
      status: err?.status,
      ms: Date.now() - start,
    });
    return null;
  }
}
