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
 * Declares which strategy a scene "naturally" wants when its asset is a
 * close-up of a single existing person whose face we should swap with the
 * user's selfie. Absence of `primaryFace` means the scene is treated as a
 * generic background and the standard strategy chain (two-pass → single-pass)
 * is used.
 *
 * Defined as an object instead of a bare string so future tiers can be added
 * (e.g. `{ strategy: 'targeted-swap', bbox: [...] }` for multi-person scenes
 * with a known target region) without another schema migration.
 *
 * @typedef {Object} PrimaryFaceHair
 * @property {'short'|'long'|'medium'} length
 *   The target person's hair-length bucket. The face-swap-only gate compares
 *   this against the selfie's parsed `Hair:` line. A strict short↔long clash
 *   forces fallback to two-pass; medium and unknown are compatible with both
 *   to avoid blocking on a flaky parse.
 *
 * @typedef {Object} PrimaryFace
 * @property {'swap-only'} strategy
 * @property {PrimaryFaceHair} [hair]
 *   Optional. Required for scenes that should reject hair-mismatched selfies
 *   from the swap-only path; absent means swap-only runs unconditionally.
 */

/**
 * @typedef {Object} SceneDef
 * @property {string} id
 * @property {string} label
 * @property {string} imagePath
 * @property {string} [nativeAspect]
 * @property {PrimaryFace} [primaryFace]
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
 * Strategies may return:
 *   - A success result with `image` set: the pipeline uses that image.
 *   - `null`: this strategy declined; the runner tries the next.
 *   - A fatal result with `fatalReason` set and no `image`: the runner stops
 *     and the pipeline returns a typed error to the caller. Used for cases
 *     where retrying with a different strategy would fail for the same
 *     reason (e.g. "no face detected in the user's selfie").
 *
 * @typedef {Object} StrategyResult
 * @property {ImageBuffer} [image]          - Final generated image (absent on fatal result).
 * @property {string} [strategyName]        - Name of the strategy that produced the image.
 * @property {Object} [debug]               - Optional debug metadata (intermediate images, timings, etc.).
 * @property {Object} [debugImages]         - Optional intermediate images for debug persistence.
 * @property {'no_face_found'} [fatalReason]
 *   When present, halts strategy fallback and maps to a 422 response.
 * @property {string} [fatalMessage]
 *   User-facing message shown when `fatalReason` is set.
 */

/**
 * @typedef {Object} GenerationStrategy
 * @property {string} name
 * @property {(ctx: StrategyContext) => boolean} canHandle
 * @property {(ctx: StrategyContext) => Promise<StrategyResult|null>} generate
 */

export const NO_FACE_FOUND_MESSAGE =
  "We couldn't find a face in your selfie. Please retake it facing the camera, with your face clearly visible and filling most of the frame.";

export const __STRATEGY_TYPES__ = true; // no-op marker so this file isn't empty at runtime
