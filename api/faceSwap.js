// Hosted face-swap wrapper used by the two-pass Boliden strategy.
//
// Uses Replicate's cdingram/face-swap (InsightFace-based). The model takes a
// target `input_image` (where the face goes) and a source `swap_image` (where
// the face comes from), and returns a URL to the swapped image.
//
// Return shape: always { image, reason }.
//   - On success:    { image: {mime, buf}, reason: null }
//   - On failure:    { image: null, reason: 'no_face_found' | 'timeout'
//                                          | 'api_error' | 'no_output'
//                                          | 'missing_inputs' | 'disabled' }
//
// The typed `reason` lets callers distinguish a recoverable infra failure
// (timeout, api_error — safe to fall back to the pre-swap image) from a
// fatal user-input failure (no_face_found — the selfie or target has no
// detectable face and no amount of retry will help). The pipeline uses that
// distinction to serve 422 instead of silently returning Pass 1.

import Replicate from 'replicate';

const DEFAULT_FACE_SWAP_MODEL =
  'cdingram/face-swap:d1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111';

const DEFAULT_FACE_SWAP_TIMEOUT_MS = 45000;

function resolveFaceSwapTimeoutMs() {
  const raw = process.env.FACE_SWAP_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_FACE_SWAP_TIMEOUT_MS;
  return Math.floor(n);
}

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
  else if (typeof first?.url === 'string') url = first.url;
  else if (typeof first.url === 'function') {
    const u = await Promise.resolve(first.url());
    url = typeof u === 'string' ? u : u?.toString?.();
  } else if (first?.url != null && typeof first.url !== 'function') {
    const u = first.url;
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

// Classify a failed Replicate run from its streamed container logs. The
// model's Python worker prints "No face found" to stdout when InsightFace's
// get() returns an empty list on either input; that's the one case we want to
// surface as a user-fixable error rather than a recoverable infra failure.
function classifyNoOutputReason(predictionLogsTail) {
  if (typeof predictionLogsTail !== 'string') return 'no_output';
  if (/No face found/i.test(predictionLogsTail)) return 'no_face_found';
  return 'no_output';
}

export async function swapFace({ targetImage, sourceFace, reqId, log, modelRef }) {
  if (!isFaceSwapAvailable()) {
    log?.(reqId, 'warn', 'faceSwap.skip.noToken');
    return { image: null, reason: 'disabled' };
  }
  if (!targetImage?.buf || !sourceFace?.buf) {
    log?.(reqId, 'warn', 'faceSwap.skip.missingInputs', {
      hasTarget: Boolean(targetImage?.buf),
      hasSource: Boolean(sourceFace?.buf),
    });
    return { image: null, reason: 'missing_inputs' };
  }

  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  const model = modelRef || process.env.REPLICATE_FACE_SWAP_MODEL || DEFAULT_FACE_SWAP_MODEL;
  const input = {
    input_image: toDataUri(targetImage),
    swap_image: toDataUri(sourceFace),
  };

  const timeoutMs = resolveFaceSwapTimeoutMs();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      const err = new Error(`face-swap timed out after ${timeoutMs}ms`);
      err.code = 'FACE_SWAP_TIMEOUT';
      reject(err);
    }, timeoutMs);
  });

  let lastPrediction = null;
  const onProgress = (p) => {
    if (p && typeof p === 'object') lastPrediction = p;
  };

  const start = Date.now();
  try {
    const output = await Promise.race([
      replicate.run(model, { input, signal: controller.signal }, onProgress),
      timeoutPromise,
    ]);
    const result = await fetchOutputAsBuffer(output);
    if (!result) {
      const first = Array.isArray(output) ? output[0] : output;
      let firstKeys = [];
      try {
        if (first && typeof first === 'object') {
          firstKeys = Object.getOwnPropertyNames(first).slice(0, 24);
        }
      } catch {
        firstKeys = ['<introspection-failed>'];
      }
      let firstPreview = null;
      try {
        if (first && typeof first === 'object') {
          firstPreview = JSON.stringify(first, (_k, v) => {
            if (typeof v === 'string' && v.length > 200) return `${v.slice(0, 200)}…(${v.length})`;
            return v;
          }).slice(0, 600);
        } else {
          firstPreview = String(first).slice(0, 200);
        }
      } catch {
        firstPreview = '<unserializable>';
      }
      let predictionLogsTail = null;
      if (typeof lastPrediction?.logs === 'string' && lastPrediction.logs.length > 0) {
        const tail = lastPrediction.logs.slice(-600);
        predictionLogsTail = tail;
      }
      const reason = classifyNoOutputReason(predictionLogsTail);
      log?.(reqId, 'warn', 'faceSwap.noOutput', {
        ms: Date.now() - start,
        reason,
        outputType: Array.isArray(output) ? 'array' : typeof output,
        outputLength: Array.isArray(output) ? output.length : undefined,
        firstItemType: Array.isArray(output) ? typeof output[0] : undefined,
        firstItemCtor:
          Array.isArray(output) && output[0]
            ? output[0]?.constructor?.name
            : output?.constructor?.name,
        firstKeys,
        hasBlobFn: typeof first?.blob === 'function',
        hasUrlFn: typeof first?.url === 'function',
        firstPreview,
        predictionId: lastPrediction?.id ?? null,
        predictionStatus: lastPrediction?.status ?? null,
        predictionError: lastPrediction?.error ?? null,
        predictionLogsTail,
      });
      return { image: null, reason };
    }
    log?.(reqId, 'log', 'faceSwap.ok', {
      ms: Date.now() - start,
      outBytes: result.buf.length,
      outMime: result.mime,
    });
    return { image: result, reason: null };
  } catch (err) {
    const aborted =
      timedOut ||
      err?.code === 'FACE_SWAP_TIMEOUT' ||
      controller.signal.aborted ||
      err?.name === 'AbortError';
    if (aborted) {
      log?.(reqId, 'error', 'faceSwap.timeout', {
        ms: Date.now() - start,
        timeoutMs,
        model,
      });
      // Fire-and-forget best-effort cancel on Replicate side so the run
      // doesn't keep burning credits. Don't await — we've already given up.
      try {
        controller.abort();
      } catch {
        // ignore
      }
      return { image: null, reason: 'timeout' };
    }
    log?.(reqId, 'error', 'faceSwap.fail', {
      message: err?.message,
      status: err?.status,
      ms: Date.now() - start,
    });
    return { image: null, reason: 'api_error' };
  } finally {
    clearTimeout(timer);
  }
}
