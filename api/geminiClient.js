// Thin wrapper around @google/genai for image generation and editing.
// Extracted from requestHandlers.js so strategy modules can depend on it
// without creating a circular import.

import { GoogleGenAI } from '@google/genai';

export function extractFirstImage(resp) {
  const candidates = resp?.candidates || [];
  for (const c of candidates) {
    const parts = c?.content?.parts || [];
    for (const p of parts) {
      if (p?.inlineData?.data) {
        const mime = p.inlineData.mimeType || 'image/png';
        const buf = Buffer.from(p.inlineData.data, 'base64');
        return { mime, buf };
      }
    }
  }
  return null;
}

// Summarize a Gemini response that did NOT contain an image so we can diagnose
// what happened: finish reason, any text Gemini returned instead (safety
// refusal messages, clarifying questions, etc.), and any non-image part types.
function summarizeNoImageResponse(resp) {
  const candidates = resp?.candidates || [];
  if (!candidates.length) {
    return {
      finishReason: null,
      text: null,
      partKinds: [],
      promptFeedback: resp?.promptFeedback ?? null,
    };
  }
  const c0 = candidates[0];
  const parts = c0?.content?.parts || [];
  const partKinds = parts.map((p) => {
    if (p?.inlineData) return `inline:${p.inlineData.mimeType || 'unknown'}`;
    if (typeof p?.text === 'string') return 'text';
    return Object.keys(p || {}).join(',') || 'unknown';
  });
  const text = parts
    .map((p) => (typeof p?.text === 'string' ? p.text : null))
    .filter(Boolean)
    .join(' | ')
    .slice(0, 400) || null;
  return {
    finishReason: c0?.finishReason ?? null,
    safetyRatings: c0?.safetyRatings ?? null,
    text,
    partKinds,
    promptFeedback: resp?.promptFeedback ?? null,
  };
}

// Run a multi-image generation. Images are sent to Gemini in the order:
// [prompt, ...referenceImages, primaryImage]. The primary image is the
// "subject" image closest to the prompt text; reference images come first
// for composition anchoring. Pass primaryImage = null for pure prompt+scene
// generation (useful in the scene-only pass of the two-pass flow).
export async function runGeminiEdit({
  apiKey,
  prompt,
  primaryImage,
  referenceImages = [],
  geminiAspectRatio = '1:1',
  model = 'gemini-2.5-flash-image',
  reqId,
  log,
}) {
  try {
    const ai = new GoogleGenAI({ apiKey });
    const contents = [{ text: prompt }];
    for (const ref of referenceImages) {
      if (!ref?.buf) continue;
      contents.push({
        inlineData: { mimeType: ref.mime || 'image/jpeg', data: ref.buf.toString('base64') },
      });
    }
    if (primaryImage?.buf) {
      contents.push({
        inlineData: {
          mimeType: primaryImage.mime || 'image/jpeg',
          data: primaryImage.buf.toString('base64'),
        },
      });
    }

    const resp = await ai.models.generateContent({
      model,
      contents,
      config: {
        temperature: 0.2,
        seed: 42,
        imageConfig: {
          aspectRatio: geminiAspectRatio,
        },
      },
    });
    const result = extractFirstImage(resp);
    if (!result && resp) {
      log?.(reqId, 'warn', 'gemini.noImage', {
        prompt: prompt.substring(0, 100),
        candidates: resp?.candidates?.length || 0,
        ...summarizeNoImageResponse(resp),
      });
    }
    return result;
  } catch (err) {
    log?.(reqId, 'error', 'gemini.error', {
      message: err?.message,
      prompt: prompt.substring(0, 100),
    });
    throw err;
  }
}
