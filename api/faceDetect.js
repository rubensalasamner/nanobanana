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
function extractBbox(text) {
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
  const box = first?.box_2d ?? first?.bbox ?? first;
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box.map(Number);
  if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return null;
  if (ymin >= ymax || xmin >= xmax) return null;
  if ([ymin, xmin, ymax, xmax].some((v) => v < 0 || v > 1000)) return null;
  return { ymin, xmin, ymax, xmax };
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

  const box = extractBbox(text);
  if (!box) {
    log?.(reqId, 'warn', 'faceDetect.noBbox', {
      ms: Date.now() - start,
      textPreview: text.slice(0, 200),
      finishReason: resp?.candidates?.[0]?.finishReason ?? null,
    });
    return null;
  }

  log?.(reqId, 'log', 'faceDetect.ok', {
    ms: Date.now() - start,
    box,
    model: detectModel,
  });
  return toNormalized(box);
}
