// Type definitions (JSDoc) for the generation-strategy pattern.
//
// A GenerationStrategy encapsulates one way of turning an uploaded selfie +
// request fields into a finished image. Multiple strategies coexist so we can
// swap the Boliden flow between single-pass Gemini (fast, one model call) and
// two-pass Gemini + face-swap (higher identity fidelity, two model calls)
// without touching the request pipeline.

/**
 * @typedef {Object} ImageBuffer
 * @property {string} mime
 * @property {Buffer} buf
 */

/**
 * @typedef {Object} AspectPreset
 * @property {string} id
 * @property {string} geminiAspectRatio
 * @property {number} exportWidth
 * @property {number} exportHeight
 * @property {number} uploadWidth
 * @property {number} uploadHeight
 * @property {string} qualitySuffix
 * @property {string} compositeQualitySuffix
 */

/**
 * @typedef {Object} SceneDef
 * @property {string} id
 * @property {string} label
 * @property {string} imagePath
 * @property {string} [nativeAspect]
 * @property {string} ppeHint
 * @property {string} [promptHint]
 * @property {string} [placementHint]
 * @property {boolean} [replaceReferenceSubject]
 */

/**
 * Context handed to a strategy when it is asked to handle a request.
 *
 * @typedef {Object} StrategyContext
 * @property {string} company               - Resolved company id.
 * @property {string|null} sceneId          - Raw scene id from the request (may be null).
 * @property {SceneDef|null} scene          - Resolved Boliden scene, or null for default company.
 * @property {'mobile'|'booth'} [clientMode] - Client mode (mobile or booth).
 * @property {'swap-only'|null} [pipeline]  - Optional pipeline override (e.g. swap-only).
 * @property {string} originalPrompt        - Raw prompt from the request (used by default strategy).
 * @property {string|null} personBrief      - Gemini-produced identity brief, or null if unavailable.
 * @property {AspectPreset} aspectPreset    - Output aspect preset.
 * @property {ImageBuffer} selfie           - Uploaded selfie.
 * @property {ImageBuffer|null} sceneImage  - Loaded scene reference image, or null if not applicable.
 * @property {string} geminiApiKey
 * @property {string} reqId
 * @property {(reqId: string, level: string, msg: string, meta?: object) => void} log
 */

/**
 * Result returned by a strategy.
 *
 * @typedef {Object} StrategyResult
 * @property {ImageBuffer} image            - Final generated image.
 * @property {string} strategyName          - Name of the strategy that produced the image.
 * @property {Object} [debug]               - Optional debug metadata (intermediate images, timings, etc.).
 */

/**
 * @typedef {Object} GenerationStrategy
 * @property {string} name
 * @property {(ctx: StrategyContext) => boolean} canHandle
 * @property {(ctx: StrategyContext) => Promise<StrategyResult|null>} generate
 */

export const __STRATEGY_TYPES__ = true; // no-op marker so this file isn't empty at runtime
