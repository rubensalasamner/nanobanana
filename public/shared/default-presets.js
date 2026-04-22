/**
 * Default (non-Boliden) style presets: single registry drives the booth style grid.
 * Filter with {@link BOOTH_CLIENT_PRESET_IDS} (booth) or pass null to {@link renderDefaultPresetGrid} for the full list.
 */

/** @typedef {{ id: string, label: string, prompt: string }} DefaultStylePreset */

/** @type {readonly DefaultStylePreset[]} */
export const DEFAULT_STYLE_PRESETS = Object.freeze([
  {
    id: 'figurine',
    label: '3D figurine',
    prompt:
      "Use the uploaded webcam photo as the only reference image. Create a 1/7-scale commercial figurine of the person in the photo, realistic style, in a real environment. Place the figurine on a computer desk with a round transparent acrylic base. Put Light Green text on the base with the person's name only if text is already present in the original image; otherwise avoid adding any text. Show a computer screen displaying the figurine's 3D modeling process and a nearby toy packaging box that uses two-dimensional flat illustrations based on the same person. Keep facial likeness accurate. Do not add extra people. Avoid watermarks or captions.",
  },
  {
    id: 'yearbook-80s',
    label: '1980’s yearbook',
    prompt:
      "Use the uploaded webcam photo as the only reference image. Generate a 1980s yearbook portrait of this person. Preserve the exact face and identity. You may change background, hairstyle, facial hair, glasses, outfit, and lighting to fit 1980s ‘glamour shots’ aesthetics (big hair, mullets, large glasses, soft/foggy lighting, fun backdrops). No added text or watermarks. Single subject only.",
  },
  {
    id: 'polaroid',
    label: 'Polaroid',
    prompt:
      'Generate a 4K ultra-realistic motion blurred instant camera image featuring the people from the reference images, posed together. Preserve their facial features, add a gentle blur, and keep the lighting uniform against a soft white curtain backdrop for a warm, candid film-style effect. Do not change their faces at all.',
  },
  {
    id: 'photo-to-painting',
    label: 'Photo to painting',
    prompt:
      'Use the uploaded webcam photo as the only reference image. Reimagine this portrait as an Impressionist oil painting set in the 1880s. Present the final as a photographed framed artwork in a matte gold frame. Maintain accurate facial likeness and identity. No added text or signatures.',
  },
  {
    id: 'fashion-60s',
    label: "60's Eras Fashion",
    prompt:
      'Use the uploaded webcam photo as the only reference image. Show me in classic fashion of the 1960s. Make the setting and environment reminiscent of the 1960s as well. Preserve facial likeness and identity. Single subject. No added text or watermarks.',
  },
  {
    id: 'hairstyle',
    label: 'Hairstyle change',
    prompt:
      "Use the uploaded webcam photo as the only reference image. Transform this person's hairstyle with a bold, radical, and dramatic change. Create a completely different hairstyle - choose from vibrant colors (bright blue, electric pink, neon green, platinum blonde, fiery red, or bold purple), extreme cuts (undercut, mohawk, shaved sides, asymmetrical bob, long waves, or spiky textured), and dramatic styles (curly, straight, braided, or voluminous). Keep the person against a simple studio backdrop with a subtle textured or gradient pattern (like mottled paint, soft bokeh, or abstract brush strokes). Avoid complex or scenic environments. Make the hairstyle transformation striking and eye-catching while keeping the same face, skin tone, and lighting. Do not modify age or body. No added text.",
  },
  {
    id: 'original-photo',
    label: 'Original photo',
    prompt:
      'Use the uploaded webcam photo exactly as provided. Preserve all details, colors, lighting, and composition without any modifications or transformations.',
  },
  {
    id: 'muppet',
    label: 'Muppet You',
    prompt:
      "A photorealistic, highly detailed cinematic photograph in the distinct, whimsical visual style of a classic Jim Henson Muppet production, transforming this photobooth selfie into a spectacular Muppet character. The participant’s core facial features and expression are preserved, but they have been meticulously recreated as a charming, friendly Muppet with colorful, textured felt skin, large friendly eyes, and shaggy yarn hair. They look utterly delighted and inspired. They are sitting comfortably at a teacher’s desk in a chaotic, joyful, and creative classroom filled with diverse puppet students (visible but slightly blurred). On the desk is a sleek laptop. Above the laptop, a magnificent, vibrant cloud of glowing, animated data streams and friendly holographic figures (all composed of the Google colors: blue, red, yellow, and green) is actively organizing piles of paperwork and floating, simplified test papers. This magical data is forming intricate patterns that resolve into symbols representing a personalized dream: [a tiny puppet version of themselves playing a tiny guitar / painting a miniature masterpiece / planning a futuristic puppet vacation]. The classroom background is warm, cluttered with classic 'Jim Henson style' handmade puppet props, books, and chalk drawings. The lighting is soft and magical, highlighting the rich textures of the felt and yarn, with specific, sparkling Google color light trails throughout. Dynamic, playful depth of field, high resolution, visually explosive Muppet digital art.",
  },
  {
    id: 'gemini-educator',
    label: 'The Gemini Educator',
    prompt:
      "A photorealistic, cinematic photograph transforming this selfie into a scene where the participant is commanding a hyper-futuristic facility called The Gemini Educator. Their facial features are preserved, looking inspired and confident. They stand at a sleek console where multiple transparent, glowing holographic projectors are active, displaying complex interactive data: swirling DNA helixes, floating mathematical equations, 3D anatomical models, and historical maps. These complex data streams and visualizations are composed entirely of the specific Google colors of deep blue, warm red, bright yellow, and forest green. The participant is interacting with these elements, subtly commanding them with an elegant gesture. They wear a technical-fabric blazer subtly incorporating the Google color palette. In the deep background, a diverse group of students watches, captivated by the dynamic, brilliant light. The lighting is dramatic and warm, with high-speed motion blur effects on the most dynamic Google-colored data streams. Style is dynamic, high resolution, visually explosive digital art.",
  },
  {
    id: 'headshot',
    label: 'Professional headshot',
    prompt:
      "Use the uploaded webcam photo as the only reference image. Transform this portrait into a high-quality professional LinkedIn headshot. Preserve the exact facial features and identity. Dress the person in professional business attire - a sharp, well-fitted suit jacket, dress shirt, and tie (or professional blazer/blouse for any gender). Use a clean, sharp, professional office or corporate background - modern office interior, professional studio backdrop, or corporate building setting with crisp, in-focus details. Apply professional photography lighting - bright, even, flattering light that enhances the subject. Add subtle professional photo filters for a polished, corporate look - enhance contrast, sharpen details, and add a professional color grade. Frame tightly on head and upper shoulders. Make the person look confident, intelligent, and professional. The overall image should be sharp, well-lit, and suitable for a professional profile. Single subject only. No added text or watermarks.",
  },
  {
    id: 'super-teacher',
    label: 'Super-Powered Teacher',
    prompt:
      "A photorealistic, highly detailed cinematic photograph transforming this photobooth selfie into an epic superhero action shot. The participant’s facial features are preserved, looking powerful, determined, and inspired. They are costumed as the 'Super-Powered Teacher,' wearing an armored, sleek suit of iridescent blue and deep green (the Google palette base colors), adorned with glowing gold and red accents. They are suspended in the air above a massive, modern city skyline. From their extended hands, they are commanding a spectacular, explosive swirl of raw energy and digital data, composed entirely of brilliant, flowing bands of blue, red, yellow, and green. Complex, holographic equations, historical timelines, and DNA sequences made of the same colors weave through the shield. The background is a dramatic sunset, casting long, warm shadows and intense highlights. Lighting is explosive, with dynamic motion blur. The overall composition is heroic and triumphant. Style is blockbuster film poster, high definition, 8k resolution digital art.",
  },
]);

/**
 * Non-Boliden kiosk / booth flow: client presets + pass-through original. Order is display order.
 * @type {readonly string[]}
 */
export const BOOTH_CLIENT_PRESET_IDS = Object.freeze([
  'figurine',
  'yearbook-80s',
  'polaroid',
  'photo-to-painting',
  'fashion-60s',
  'hairstyle',
  'original-photo',
]);

/**
 * @param {readonly string[] | null | undefined} activePresetIds - If null/undefined, all presets in {@link DEFAULT_STYLE_PRESETS} are shown.
 * @returns {readonly DefaultStylePreset[]}
 */
function resolvePresetsToRender(activePresetIds) {
  if (!activePresetIds || activePresetIds.length === 0) {
    return DEFAULT_STYLE_PRESETS;
  }
  const byId = new Map(DEFAULT_STYLE_PRESETS.map((p) => [p.id, p]));
  return activePresetIds.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * Fills `container` with default style cards (`data-prompt` + optional `data-preset-id`).
 * @param {HTMLElement | null} container
 * @param {readonly string[] | null} [activePresetIds] - Omit or null to show every registered preset (e.g. mobile default company).
 */
export function renderDefaultPresetGrid(container, activePresetIds = null) {
  if (!container) return;
  container.replaceChildren();
  for (const preset of resolvePresetsToRender(activePresetIds)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'style-card';
    btn.dataset.prompt = preset.prompt;
    btn.dataset.presetId = preset.id;
    btn.dataset.cardKey = `preset:${preset.id}`;
    btn.textContent = preset.label;
    container.appendChild(btn);
  }
}
