// Strategy registry and selector.
//
// Order matters: the first strategy whose canHandle() returns true wins. The
// default strategy is last because its canHandle() always returns true.
//
// Boliden scenes prefer the two-pass face-swap strategy when a Replicate token
// is configured (highest identity fidelity). When it isn't configured or a
// scene opts out via useFaceSwap: false, they fall back to the single-pass
// Gemini strategy. Non-Boliden requests always use the default strategy.

import { defaultStrategy } from './default.js';
import { faceSwapOnlyStrategy } from './face-swap-only.js';
import { singlePassGeminiStrategy } from './single-pass-gemini.js';
import { twoPassFaceSwapStrategy } from './two-pass-face-swap.js';

/** @type {import('./types.js').GenerationStrategy[]} */
export const STRATEGIES = [
  faceSwapOnlyStrategy,
  twoPassFaceSwapStrategy,
  singlePassGeminiStrategy,
  defaultStrategy,
];

/**
 * Pick the first strategy that can handle the given context. Returns null if
 * no strategy accepts the context — callers must handle that case explicitly
 * (typically a 4xx response, not a silent default fallback).
 *
 * @param {import('./types.js').StrategyContext} ctx
 * @returns {import('./types.js').GenerationStrategy|null}
 */
export function selectStrategy(ctx) {
  for (const s of STRATEGIES) {
    if (s.canHandle(ctx)) return s;
  }
  return null;
}

/**
 * Run the selected strategy with automatic fallback: if the chosen strategy
 * returns null (couldn't produce an image), try the next one in priority
 * order. The default strategy is guaranteed to be attempted last.
 *
 * @param {import('./types.js').StrategyContext} ctx
 * @returns {Promise<import('./types.js').StrategyResult|null>}
 */
export async function runStrategyWithFallback(ctx) {
  const tried = [];
  for (const s of STRATEGIES) {
    if (!s.canHandle(ctx)) continue;
    tried.push(s.name);
    ctx.log(ctx.reqId, 'log', 'strategy.attempt', { name: s.name });
    try {
      const result = await s.generate(ctx);
      if (result?.image) {
        ctx.log(ctx.reqId, 'log', 'strategy.ok', {
          name: result.strategyName || s.name,
          tried,
        });
        return result;
      }
      ctx.log(ctx.reqId, 'warn', 'strategy.noImage', { name: s.name });
    } catch (err) {
      ctx.log(ctx.reqId, 'error', 'strategy.error', {
        name: s.name,
        message: err?.message,
      });
    }
  }
  ctx.log(ctx.reqId, 'error', 'strategy.allFailed', { tried });
  return null;
}

export {
  defaultStrategy,
  faceSwapOnlyStrategy,
  singlePassGeminiStrategy,
  twoPassFaceSwapStrategy,
};
