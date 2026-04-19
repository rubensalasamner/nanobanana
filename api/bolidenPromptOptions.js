/** Opt-in shorter Boliden composite prompts (for debugging IMAGE_OTHER / model limits). */
export function resolveBolidenSlimPrompts() {
  const v = String(process.env.BOLIDEN_SLIM_PROMPTS ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
