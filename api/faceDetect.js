// Gemini-based face bounding-box detection for targeted face swap.
//
// Given the Pass 1 composite image (Gemini output) and the original scene
// image it was built from, ask Gemini 2.5 Flash to return the bounding box
// of the face of the person that is present in the composite but not in the
// original scene (i.e. the newly-added worker). That bbox is then used by
// api/targetedFaceSwap.js to crop just that face region so the Replicate
// face-swap model can't re-target an existing worker with a more prominent
// face.
//
// Why Gemini instead of a dedicated detector:
//   - The project is already authenticated against Gemini; no new API token
//     or dependency is needed and this also works on Vercel serverless.
//   - Gemini 2.5 Flash supports structured bbox output in `box_2d` format
//     normalized to 0-1000 (ymin, xmin, ymax, xmax).
//   - Running detection as a second Gemini call adds ~1-3s warm and piggybacks
//     on a connection that is already warm from Pass 1 (no extra cold start).
//
// Graceful degradation: if the detect call fails, times out, or returns a
// non-parseable/empty response, we return null. Callers (targetedFaceSwap)
// fall back to the existing full-frame swap, so there is no regression.

import { GoogleGenAI } from '@google/genai';

const DEFAULT_DETECT_MODEL = 'gemini-2.5-flash';
const DETECT_TIMEOUT_MS = 15_000;

/**
 * @returns {boolean}
 */
export function isFaceDetectEnabled() {
  if (!process.env.GEMINI_API_KEY) return false;
  const flag = String(process.env.ENABLE_TARGETED_FACE_SWAP ?? 'true').toLowerCase();
  return flag !== 'false' && flag !== '0' && flag !== 'no';
}

// Parse Gemini's text response and extract a box_2d. The model is asked to
// return a JSON array with one item; it sometimes wraps the JSON in code
// fences or adds preamble text. Tolerate both.
//
// Robustness layers (each guards an observed Gemini misbehaviour):
//   1. Regex-extract the first JSON array — the model occasionally adds
//      preamble or wraps the array in markdown fences.
//   2. Accept three field shapes: `box_2d` (per the prompt), `bbox`, or the
//      raw 4-element array. The model has emitted all three across runs.
//   3. Tolerate arrays with more than 4 elements by truncating to the first
//      4 and revalidating. Observed in run JMWZ6tDz on coffee-break where
//      the model emitted [205, 365, 345, 435, 435] (5 elements with a
//      duplicated trailing value). The first 4 form a valid box (after the
//      h/w recovery layer below) and we'd rather use it than fall through
//      to a full-frame swap.
//   4. If the standard [ymin,xmin,ymax,xmax] interpretation produces
//      ymin >= ymax or xmin >= xmax, retry with a [ymin,xmin,height,width]
//      interpretation. Observed in run aDB-QDRJ on meeting-at-the-mill where
//      the model emitted [365,255,335,485] (h/w shape). Recovery is
//      conservative: only kicks in when the standard shape is invalid, so a
//      well-formed box never gets reinterpreted.
//   5. Aspect-ratio sanity check: a face bbox is roughly square; reject
//      anything wildly elongated (>5:1 either way). This is what catches a
//      false positive where the model returns a bbox enclosing a doorway or
//      a horizontal stripe.
//
// Returns { box, recovered } so the caller can log when fallback parsing
// kicked in (useful for monitoring how flaky the model is). `recovered` is a
// non-null string tag identifying which fallback layer fired:
//   - 'truncated': source array had >4 elements, we used the first 4
//   - 'h-w':       coords reinterpreted as [ymin,xmin,height,width]
//   - 'truncated+h-w': both layers fired (rare)
//
// @param {string} text
// @returns {null | { box: {ymin:number,xmin:number,ymax:number,xmax:number}, recovered: string|null }}
export function parseBboxResponse(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const first = parsed[0];
  const raw = first?.box_2d ?? first?.bbox ?? first;
  if (!Array.isArray(raw) || raw.length < 4) return null;

  // Tolerate arrays with more than 4 elements by using only the first 4.
  // Observed in run JMWZ6tDz on coffee-break: [205, 365, 345, 435, 435].
  // The 5th element appears to be a duplicate/noise; the first 4 form a
  // valid box (h/w shape, recovered by the layer below).
  const truncated = raw.length > 4;
  const nums = raw.slice(0, 4).map(Number);
  if (!nums.every(Number.isFinite)) return null;
  if (nums.some((v) => v < 0 || v > 1000)) return null;

  const [a, b, c, d] = nums;
  const ymin = a;
  const xmin = b;
  let ymax = c;
  let xmax = d;
  let hwRecovered = false;

  if (ymin >= ymax || xmin >= xmax) {
    const altYmax = ymin + c;
    const altXmax = xmin + d;
    const valid =
      altYmax > ymin && altXmax > xmin && altYmax <= 1000 && altXmax <= 1000;
    if (!valid) return null;
    ymax = altYmax;
    xmax = altXmax;
    hwRecovered = true;
  }

  const w = xmax - xmin;
  const h = ymax - ymin;
  const ratio = w / h;
  if (!Number.isFinite(ratio) || ratio < 0.2 || ratio > 5) return null;

  const tags = [truncated && 'truncated', hwRecovered && 'h-w'].filter(Boolean);
  const recovered = tags.length > 0 ? tags.join('+') : null;

  return { box: { ymin, xmin, ymax, xmax }, recovered };
}

function toNormalized(box) {
  const clamp = (v) => Math.max(0, Math.min(1, v / 1000));
  return {
    yMinNorm: clamp(box.ymin),
    xMinNorm: clamp(box.xmin),
    yMaxNorm: clamp(box.ymax),
    xMaxNorm: clamp(box.xmax),
  };
}

/**
 * @param {object} args
 * @param {{mime:string,buf:Buffer}} args.modifiedImage  - The pass-1 composite that may contain a new person.
 * @param {{mime:string,buf:Buffer}} args.originalScene  - The baseline scene used as reference.
 * @param {string} [args.apiKey]
 * @param {string} [args.model]
 * @param {string} [args.reqId]
 * @param {Function} [args.log]
 * @returns {Promise<null|{yMinNorm:number,xMinNorm:number,yMaxNorm:number,xMaxNorm:number}>}
 */
export async function detectNewFaceBbox({
  modifiedImage,
  originalScene,
  apiKey,
  model,
  reqId,
  log,
}) {
  if (!modifiedImage?.buf || !originalScene?.buf) {
    log?.(reqId, 'warn', 'faceDetect.skip.missingInputs', {
      hasModified: Boolean(modifiedImage?.buf),
      hasOriginal: Boolean(originalScene?.buf),
    });
    return null;
  }

  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    log?.(reqId, 'warn', 'faceDetect.skip.noKey');
    return null;
  }

  const detectModel = model || process.env.FACE_DETECT_MODEL || DEFAULT_DETECT_MODEL;
  const ai = new GoogleGenAI({ apiKey: key });

  const prompt = [
    'You are given two images of an industrial workplace.',
    'Image 1 = ORIGINAL scene.',
    'Image 2 = MODIFIED scene. It contains one additional person who was NOT in image 1.',
    'Task: locate the FACE of that newly-added person in IMAGE 2 only.',
    'Return ONLY a JSON array with exactly one object of this shape:',
    '[{"box_2d":[ymin,xmin,ymax,xmax],"label":"new_worker_face"}]',
    'Coordinates are integers in 0-1000 normalized to image 2, with ymin<ymax and xmin<xmax.',
    'The box must tightly enclose the FACE (not full body) of the NEW person only.',
    'Never return a bounding box for a person who already existed in image 1.',
    'If there is no such new person, return [].',
  ].join('\n');

  const start = Date.now();
  let resp;
  try {
    resp = await Promise.race([
      ai.models.generateContent({
        model: detectModel,
        contents: [
          { text: prompt },
          {
            inlineData: {
              mimeType: originalScene.mime || 'image/jpeg',
              data: originalScene.buf.toString('base64'),
            },
          },
          {
            inlineData: {
              mimeType: modifiedImage.mime || 'image/png',
              data: modifiedImage.buf.toString('base64'),
            },
          },
        ],
        config: { temperature: 0 },
      }),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              Object.assign(new Error(`face-detect timed out after ${DETECT_TIMEOUT_MS}ms`), {
                code: 'FACE_DETECT_TIMEOUT',
              })
            ),
          DETECT_TIMEOUT_MS
        )
      ),
    ]);
  } catch (err) {
    log?.(reqId, 'error', 'faceDetect.fail', {
      message: err?.message,
      code: err?.code,
      ms: Date.now() - start,
    });
    return null;
  }

  const text =
    resp?.candidates?.[0]?.content?.parts
      ?.map((p) => (typeof p?.text === 'string' ? p.text : null))
      .filter(Boolean)
      .join('\n') || '';

  const parsed = parseBboxResponse(text);
  if (!parsed) {
    log?.(reqId, 'warn', 'faceDetect.noBbox', {
      ms: Date.now() - start,
      textPreview: text.slice(0, 200),
      finishReason: resp?.candidates?.[0]?.finishReason ?? null,
    });
    return null;
  }

  log?.(reqId, 'log', 'faceDetect.ok', {
    ms: Date.now() - start,
    box: parsed.box,
    recovered: parsed.recovered,
    model: detectModel,
  });
  return toNormalized(parsed.box);
}
