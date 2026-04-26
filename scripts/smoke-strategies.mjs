// Smoke test: verify prompt builders render, strategy selector picks the
// right strategy under various env/scene combinations, and there are no
// import cycles. Run with: `node scripts/smoke-strategies.mjs`

import sharp from 'sharp';

import { BOLIDEN_SCENE_LIBRARY, COMPANY_IDS } from '../public/shared/company-scenes.js';
import { buildInsertPrompt, parseDescribeResponse } from '../public/shared/boliden/index.js';
import { defaultStrategy, faceSwapOnlyStrategy, selectStrategy, STRATEGIES } from '../api/strategies/index.js';
import { NO_FACE_FOUND_MESSAGE } from '../api/strategies/types.js';
import { getOutputAspectPreset } from '../public/shared/output-aspect.js';
import {
  isFaceRestoreEnabled,
  resolveCodeformerFidelity,
} from '../api/faceRestore.js';
import { isFaceDetectEnabled, parseBboxResponse } from '../api/faceDetect.js';
import { isForegroundHero, isTargetedFaceSwapAvailable } from '../api/targetedFaceSwap.js';
import { normalizeImage } from '../api/normalizeImage.js';
import {
  compositeIntoRegion,
  extractCrop,
  isValidCropRect,
} from '../api/cropComposite.js';

const aspectPreset = getOutputAspectPreset('16:9');
const personBrief = [
  'Hair: short brown, straight',
  'Face: oval',
  'Eyes: hazel, almond',
  'Nose: straight, medium',
  'Mouth: medium lips',
  'Skin: light, even',
  'Age: mid-30s',
  'Distinctive: none',
].join('\n');

const log = () => {};
const ctxBase = {
  originalPrompt: '',
  personBrief,
  aspectPreset,
  selfie: { mime: 'image/jpeg', buf: Buffer.alloc(16) },
  sceneImage: { mime: 'image/jpeg', buf: Buffer.alloc(16) },
  geminiApiKey: 'fake',
  reqId: 'smoke',
  log,
};

function checkPrompts() {
  for (const scene of Object.values(BOLIDEN_SCENE_LIBRARY)) {
    const insert = buildInsertPrompt(scene, personBrief, {
      qualitySuffix: aspectPreset.qualitySuffix,
      compositeQualitySuffix: aspectPreset.compositeQualitySuffix,
    });
    if (!insert.prompt || !insert.fallbackPrompt) {
      throw new Error(`Empty prompt for scene ${scene.id}`);
    }
    if (!insert.prompt.includes('image 1') || !insert.prompt.includes('image 2')) {
      throw new Error(`insert prompt missing image markers for ${scene.id}`);
    }
    if (!insert.prompt.includes('IDENTITY + FACE LIGHTING')) {
      throw new Error(`strict insert prompt missing identity-lock block for ${scene.id}`);
    }

    const placeholder = buildInsertPrompt(
      scene,
      personBrief,
      {
        qualitySuffix: aspectPreset.qualitySuffix,
        compositeQualitySuffix: aspectPreset.compositeQualitySuffix,
      },
      { faceWillBeSwapped: true }
    );
    if (!placeholder.prompt.includes('placeholder face')) {
      throw new Error(`placeholder insert prompt missing placeholder marker for ${scene.id}`);
    }
    if (placeholder.prompt.includes('Facial geometry: copy the face')) {
      throw new Error(`placeholder insert prompt still has strict identity-lock for ${scene.id}`);
    }
    if (!placeholder.prompt.includes('Head-to-body proportion')) {
      throw new Error(`placeholder insert prompt missing proportion constraint for ${scene.id}`);
    }
    if (!/Size anchor \(HARD/.test(placeholder.prompt)) {
      throw new Error(`placeholder insert prompt missing HARD size anchor for ${scene.id}`);
    }
    if (!/NO LARGER than the heads of the existing workers/i.test(placeholder.prompt)) {
      throw new Error(`placeholder insert prompt missing existing-worker head anchor for ${scene.id}`);
    }
    if (!/head ≤ 12%/.test(placeholder.prompt)) {
      throw new Error(`placeholder insert prompt missing absolute 12% head cap for ${scene.id}`);
    }
    if (/Swap targeting hint/i.test(placeholder.prompt)) {
      throw new Error(
        `placeholder insert prompt must not include the swap-targeting hint (it invites foreground-hero composition) for ${scene.id}`
      );
    }
    if (placeholder.prompt.includes('is the PRIMARY SUBJECT')) {
      throw new Error(`placeholder insert prompt should not force primary-subject framing for ${scene.id}`);
    }
    if (!placeholder.prompt.includes('lit by')) {
      throw new Error(`placeholder insert prompt missing face-lighting integration for ${scene.id}`);
    }

    const slimSuffixes = {
      qualitySuffix: aspectPreset.qualitySuffix,
      compositeQualitySuffix: aspectPreset.compositeQualitySuffix,
    };
    const slimComposite = buildInsertPrompt(scene, personBrief, slimSuffixes, {
      slim: true,
      aspectId: aspectPreset.id,
    });
    const slimPlaceholder = buildInsertPrompt(scene, personBrief, slimSuffixes, {
      slim: true,
      aspectId: aspectPreset.id,
      faceWillBeSwapped: true,
    });
    if (slimComposite.prompt.length >= insert.prompt.length) {
      throw new Error(`slim composite should be shorter than full for ${scene.id}`);
    }
    if (slimPlaceholder.prompt.length >= placeholder.prompt.length) {
      throw new Error(`slim placeholder should be shorter than full placeholder for ${scene.id}`);
    }
    if (!slimComposite.prompt.includes('IDENTITY + LIGHTING')) {
      throw new Error(`slim strict should use compact identity header for ${scene.id}`);
    }
    if (!slimPlaceholder.prompt.includes('FACE (placeholder')) {
      throw new Error(`slim placeholder missing compact face header for ${scene.id}`);
    }
    if (!/Size anchor \(HARD/.test(slimPlaceholder.prompt)) {
      throw new Error(`slim placeholder missing HARD size anchor for ${scene.id}`);
    }
    if (!/NO LARGER than the heads of the existing workers/i.test(slimPlaceholder.prompt)) {
      throw new Error(`slim placeholder missing existing-worker head anchor for ${scene.id}`);
    }
    if (!/head ≤ 12%/.test(slimPlaceholder.prompt)) {
      throw new Error(`slim placeholder missing absolute 12% head cap for ${scene.id}`);
    }
    if (/Swap targeting hint/i.test(slimPlaceholder.prompt)) {
      throw new Error(
        `slim placeholder must not include the swap-targeting hint (foreground-hero risk) for ${scene.id}`
      );
    }
    if (slimPlaceholder.prompt.includes('is the PRIMARY SUBJECT')) {
      throw new Error(`slim placeholder should not force primary-subject framing for ${scene.id}`);
    }
    if (!slimPlaceholder.prompt.includes('selfie lighting') && !slimPlaceholder.prompt.includes('studio')) {
      throw new Error(`slim placeholder missing face-lighting constraint for ${scene.id}`);
    }
    if (!slimPlaceholder.prompt.includes('cutout') && !slimPlaceholder.prompt.includes('halo')) {
      throw new Error(`slim placeholder missing edge-blend / no-halo constraint for ${scene.id}`);
    }

    console.log(
      JSON.stringify({
        scene: scene.id,
        replaceReferenceSubject: scene.replaceReferenceSubject === true,
        insertLen: insert.prompt.length,
        insertFallbackLen: insert.fallbackPrompt.length,
        placeholderLen: placeholder.prompt.length,
        slimCompositeLen: slimComposite.prompt.length,
        slimPlaceholderLen: slimPlaceholder.prompt.length,
      })
    );
  }
}

function checkSelector() {
  const nonBoliden = selectStrategy({
    ...ctxBase,
    company: COMPANY_IDS.DEFAULT,
    sceneId: null,
    scene: null,
  });
  if (nonBoliden?.name !== 'default') {
    throw new Error(`non-Boliden should use default, got ${nonBoliden?.name}`);
  }

  const bolidenNoScene = selectStrategy({
    ...ctxBase,
    company: COMPANY_IDS.BOLIDEN,
    sceneId: 'definitely-not-a-real-scene',
    scene: null,
  });
  if (bolidenNoScene !== null) {
    throw new Error(
      `Boliden w/ unknown scene should return null, got ${bolidenNoScene?.name}`
    );
  }

  const scene = BOLIDEN_SCENE_LIBRARY['underground-drill'];
  const savedToken = process.env.REPLICATE_API_TOKEN;

  delete process.env.REPLICATE_API_TOKEN;
  const boliden = selectStrategy({
    ...ctxBase,
    company: COMPANY_IDS.BOLIDEN,
    sceneId: scene.id,
    scene,
  });
  if (boliden.name !== 'single-pass-gemini') {
    throw new Error(`Boliden w/o token should use single-pass, got ${boliden.name}`);
  }

  process.env.REPLICATE_API_TOKEN = 'fake-for-selector';
  const bolidenTwoPass = selectStrategy({
    ...ctxBase,
    company: COMPANY_IDS.BOLIDEN,
    sceneId: scene.id,
    scene,
  });
  if (bolidenTwoPass?.name !== 'two-pass-face-swap') {
    throw new Error(`Boliden w/ token should use two-pass, got ${bolidenTwoPass?.name}`);
  }

  // Metadata-driven swap-only selection: scene declares
  // primaryFace.strategy='swap-only' and runs in mobile mode.
  for (const swapOnlyId of ['coworker-with-machine', 'coworker-with-measuring-instrument']) {
    const swapOnlyScene = BOLIDEN_SCENE_LIBRARY[swapOnlyId];
    if (swapOnlyScene?.primaryFace?.strategy !== 'swap-only') {
      throw new Error(
        `${swapOnlyId} must declare primaryFace.strategy='swap-only' to drive face-swap-only selection`
      );
    }
    const bolidenSwapOnly = selectStrategy({
      ...ctxBase,
      clientMode: 'mobile',
      company: COMPANY_IDS.BOLIDEN,
      sceneId: swapOnlyScene.id,
      scene: swapOnlyScene,
    });
    if (bolidenSwapOnly?.name !== faceSwapOnlyStrategy.name) {
      throw new Error(
        `mobile + primaryFace=swap-only should choose ${faceSwapOnlyStrategy.name} for ${swapOnlyId}, got ${bolidenSwapOnly?.name}`
      );
    }
  }

  // Booth mode is intentionally restricted away from face-swap-only even on a
  // primaryFace scene; it should fall through to the standard chain.
  const swapOnlySceneForBooth = BOLIDEN_SCENE_LIBRARY['coworker-with-machine'];
  const boothSwapOnly = selectStrategy({
    ...ctxBase,
    clientMode: 'booth',
    company: COMPANY_IDS.BOLIDEN,
    sceneId: swapOnlySceneForBooth.id,
    scene: swapOnlySceneForBooth,
  });
  if (boothSwapOnly?.name === faceSwapOnlyStrategy.name) {
    throw new Error(
      `booth mode must NOT select ${faceSwapOnlyStrategy.name}, got ${boothSwapOnly?.name}`
    );
  }

  // Negative case: a scene with no primaryFace must not match face-swap-only
  // even in mobile mode. It must fall through to two-pass / single-pass.
  const noPrimaryScene = BOLIDEN_SCENE_LIBRARY['underground-drill'];
  if (noPrimaryScene?.primaryFace) {
    throw new Error(
      `underground-drill should NOT declare primaryFace; smoke fixture is invalid`
    );
  }
  const noPrimaryStrategy = selectStrategy({
    ...ctxBase,
    clientMode: 'mobile',
    company: COMPANY_IDS.BOLIDEN,
    sceneId: noPrimaryScene.id,
    scene: noPrimaryScene,
  });
  if (noPrimaryStrategy?.name === faceSwapOnlyStrategy.name) {
    throw new Error(
      `scene without primaryFace must NOT select ${faceSwapOnlyStrategy.name}, got ${noPrimaryStrategy?.name}`
    );
  }

  const optedOutScene = { ...scene, useFaceSwap: false };
  const bolidenOptOut = selectStrategy({
    ...ctxBase,
    company: COMPANY_IDS.BOLIDEN,
    sceneId: optedOutScene.id,
    scene: optedOutScene,
  });
  if (bolidenOptOut?.name !== 'single-pass-gemini') {
    throw new Error(`Scene opt-out should use single-pass, got ${bolidenOptOut?.name}`);
  }

  if (savedToken === undefined) delete process.env.REPLICATE_API_TOKEN;
  else process.env.REPLICATE_API_TOKEN = savedToken;

  // Boliden must never fall all the way through to the default strategy — it
  // would silently ignore the scene image.
  const bolidenIntoDefault = defaultStrategy.canHandle({
    ...ctxBase,
    company: COMPANY_IDS.BOLIDEN,
    sceneId: scene.id,
    scene,
  });
  if (bolidenIntoDefault) {
    throw new Error('defaultStrategy.canHandle must return false for Boliden');
  }

  console.log(
    JSON.stringify({
      strategiesRegistered: STRATEGIES.map((s) => s.name),
      selectorChecks: 'ok',
    })
  );
}

function checkFaceRestoreFlags() {
  const savedToken = process.env.REPLICATE_API_TOKEN;
  const savedEnable = process.env.ENABLE_FACE_RESTORE;
  const savedFidelity = process.env.CODEFORMER_FIDELITY;

  delete process.env.REPLICATE_API_TOKEN;
  delete process.env.ENABLE_FACE_RESTORE;
  if (isFaceRestoreEnabled()) {
    throw new Error('face-restore must be disabled without REPLICATE_API_TOKEN');
  }

  process.env.REPLICATE_API_TOKEN = 'fake-for-smoke';
  delete process.env.ENABLE_FACE_RESTORE;
  if (!isFaceRestoreEnabled()) {
    throw new Error('face-restore should default to enabled when token is present');
  }

  process.env.ENABLE_FACE_RESTORE = 'false';
  if (isFaceRestoreEnabled()) {
    throw new Error('ENABLE_FACE_RESTORE=false must disable restore');
  }

  process.env.ENABLE_FACE_RESTORE = 'true';
  if (!isFaceRestoreEnabled()) {
    throw new Error('ENABLE_FACE_RESTORE=true must enable restore');
  }

  delete process.env.CODEFORMER_FIDELITY;
  if (resolveCodeformerFidelity() !== 0.7) {
    throw new Error('default fidelity must be 0.7');
  }
  process.env.CODEFORMER_FIDELITY = '0.4';
  if (resolveCodeformerFidelity() !== 0.4) {
    throw new Error('CODEFORMER_FIDELITY=0.4 must override default');
  }
  process.env.CODEFORMER_FIDELITY = 'garbage';
  if (resolveCodeformerFidelity() !== 0.7) {
    throw new Error('invalid fidelity must fall back to 0.7');
  }
  process.env.CODEFORMER_FIDELITY = '2';
  if (resolveCodeformerFidelity() !== 0.7) {
    throw new Error('out-of-range fidelity must fall back to 0.7');
  }

  if (savedToken === undefined) delete process.env.REPLICATE_API_TOKEN;
  else process.env.REPLICATE_API_TOKEN = savedToken;
  if (savedEnable === undefined) delete process.env.ENABLE_FACE_RESTORE;
  else process.env.ENABLE_FACE_RESTORE = savedEnable;
  if (savedFidelity === undefined) delete process.env.CODEFORMER_FIDELITY;
  else process.env.CODEFORMER_FIDELITY = savedFidelity;

  console.log(JSON.stringify({ faceRestoreChecks: 'ok' }));
}

function checkTargetedFaceSwapFlags() {
  const savedKey = process.env.GEMINI_API_KEY;
  const savedFlag = process.env.ENABLE_TARGETED_FACE_SWAP;

  delete process.env.GEMINI_API_KEY;
  delete process.env.ENABLE_TARGETED_FACE_SWAP;
  if (isFaceDetectEnabled()) {
    throw new Error('targeted face-swap must be disabled without GEMINI_API_KEY');
  }
  if (isTargetedFaceSwapAvailable()) {
    throw new Error('isTargetedFaceSwapAvailable must be false without GEMINI_API_KEY');
  }

  process.env.GEMINI_API_KEY = 'fake-for-smoke';
  delete process.env.ENABLE_TARGETED_FACE_SWAP;
  if (!isFaceDetectEnabled()) {
    throw new Error('targeted face-swap should default to enabled when key is present');
  }
  if (!isTargetedFaceSwapAvailable()) {
    throw new Error('isTargetedFaceSwapAvailable must be true when key is present by default');
  }

  process.env.ENABLE_TARGETED_FACE_SWAP = 'false';
  if (isFaceDetectEnabled()) {
    throw new Error('ENABLE_TARGETED_FACE_SWAP=false must disable targeted face-swap');
  }

  process.env.ENABLE_TARGETED_FACE_SWAP = '0';
  if (isFaceDetectEnabled()) {
    throw new Error('ENABLE_TARGETED_FACE_SWAP=0 must disable targeted face-swap');
  }

  process.env.ENABLE_TARGETED_FACE_SWAP = 'true';
  if (!isFaceDetectEnabled()) {
    throw new Error('ENABLE_TARGETED_FACE_SWAP=true must enable targeted face-swap');
  }

  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedKey;
  if (savedFlag === undefined) delete process.env.ENABLE_TARGETED_FACE_SWAP;
  else process.env.ENABLE_TARGETED_FACE_SWAP = savedFlag;

  console.log(JSON.stringify({ targetedFaceSwapChecks: 'ok' }));
}

async function checkNormalizeImage() {
  const small = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .jpeg()
    .toBuffer();

  const result = await normalizeImage({ buf: small, mime: 'image/jpeg' });
  if (!result.buf || !Buffer.isBuffer(result.buf)) {
    throw new Error('normalizeImage must return a Buffer on valid input');
  }
  if (result.mime !== 'image/jpeg') {
    throw new Error(`normalizeImage must output image/jpeg, got ${result.mime}`);
  }
  if (result.width !== 32 || result.height !== 32) {
    throw new Error(`normalizeImage must preserve dimensions, got ${result.width}x${result.height}`);
  }
  if (result.normalized !== true) {
    throw new Error('normalizeImage must mark normalized=true on valid input');
  }

  const empty = await normalizeImage({ buf: null, mime: null });
  if (empty.buf !== null || empty.reason !== 'empty-input') {
    throw new Error('normalizeImage must handle empty input without throwing');
  }

  const garbage = await normalizeImage({
    buf: Buffer.from('not an image at all'),
    mime: 'image/jpeg',
  });
  if (garbage.normalized !== false || garbage.reason !== 'decode-failed') {
    throw new Error('normalizeImage must return original buffer + decode-failed on unreadable input');
  }

  console.log(JSON.stringify({ normalizeImageChecks: 'ok' }));
}

function checkFatalReasonExports() {
  if (typeof NO_FACE_FOUND_MESSAGE !== 'string' || NO_FACE_FOUND_MESSAGE.length < 10) {
    throw new Error('NO_FACE_FOUND_MESSAGE must be a non-trivial user-facing string');
  }
  console.log(JSON.stringify({ fatalReasonExports: 'ok' }));
}

function checkParseDescribeResponse() {
  // Empty / null inputs return a fully-null record so callers can branch on
  // `faceDetected === false` without false positives from missing input.
  for (const empty of [null, undefined, '', '   ', '\n\n']) {
    const r = parseDescribeResponse(empty);
    if (r.brief !== null || r.faceDetected !== null || r.raw !== null) {
      throw new Error(`empty input ${JSON.stringify(empty)} must yield all-null result, got ${JSON.stringify(r)}`);
    }
  }

  const yes = parseDescribeResponse(
    [
      'Face detected: yes',
      'Hair: short brown, straight',
      'Face: oval',
      'Eyes: hazel, almond',
      'Nose: straight, medium',
      'Mouth: medium lips',
      'Skin: light, even',
      'Age: mid-30s',
      'Distinctive: none',
    ].join('\n')
  );
  if (yes.faceDetected !== true) {
    throw new Error(`yes verdict must parse to true, got ${yes.faceDetected}`);
  }
  if (!yes.brief || yes.brief.includes('Face detected')) {
    throw new Error('yes verdict must strip the verdict line from the brief');
  }
  if (!yes.brief.startsWith('Hair:')) {
    throw new Error(`yes verdict brief must start at the first labeled line, got ${JSON.stringify(yes.brief.slice(0, 40))}`);
  }

  for (const variant of ['Face detected: no', 'face detected: no', 'Face detected:  NO ']) {
    const r = parseDescribeResponse(variant);
    if (r.faceDetected !== false) {
      throw new Error(`"${variant}" must parse as faceDetected=false, got ${r.faceDetected}`);
    }
    if (r.brief !== null) {
      throw new Error(`"${variant}" must yield null brief, got ${JSON.stringify(r.brief)}`);
    }
  }

  // Malformed: model ignored the format. Be conservative — return the text as
  // the brief so downstream prompts still work, and signal `null` (not false)
  // for faceDetected so the pipeline doesn't fail-fast on a flaky parse.
  const malformed = parseDescribeResponse('Hair: short brown\nFace: oval');
  if (malformed.faceDetected !== null) {
    throw new Error(`malformed response must yield faceDetected=null, got ${malformed.faceDetected}`);
  }
  if (malformed.brief !== 'Hair: short brown\nFace: oval') {
    throw new Error(`malformed response must preserve text as brief, got ${JSON.stringify(malformed.brief)}`);
  }

  // Edge: the verdict line is correct but the body is empty (model said yes
  // but returned nothing else). Treat as detected with null brief — the
  // pipeline can still proceed without a brief.
  const yesNoBody = parseDescribeResponse('Face detected: yes');
  if (yesNoBody.faceDetected !== true || yesNoBody.brief !== null) {
    throw new Error(
      `yes-with-no-body must yield {faceDetected:true, brief:null}, got ${JSON.stringify(yesNoBody)}`
    );
  }

  console.log(JSON.stringify({ parseDescribeResponseChecks: 'ok' }));
}

function checkParseBboxResponse() {
  for (const empty of [null, undefined, '', '   ', 'no JSON here']) {
    if (parseBboxResponse(empty) !== null) {
      throw new Error(`empty/non-JSON input ${JSON.stringify(empty)} must yield null`);
    }
  }

  const standard = parseBboxResponse(
    '[{"box_2d":[100,200,400,500],"label":"new_worker_face"}]'
  );
  if (!standard || standard.recovered !== null) {
    throw new Error(`standard bbox must parse with recovered=null, got ${JSON.stringify(standard)}`);
  }
  if (
    standard.box.ymin !== 100 ||
    standard.box.xmin !== 200 ||
    standard.box.ymax !== 400 ||
    standard.box.xmax !== 500
  ) {
    throw new Error(`standard bbox parsed wrong values: ${JSON.stringify(standard.box)}`);
  }

  // The exact shape that broke run aDB-QDRJ on meeting-at-the-mill:
  // [365, 255, 335, 485] is invalid as [ymin,xmin,ymax,xmax] (ymin>ymax)
  // but valid as [ymin,xmin,height,width] -> ymax=700, xmax=740.
  const recovered = parseBboxResponse('[{"box_2d":[365,255,335,485]}]');
  if (!recovered || recovered.recovered !== 'h-w') {
    throw new Error(
      `aDB-QDRJ regression: malformed bbox must recover via h-w, got ${JSON.stringify(recovered)}`
    );
  }
  if (recovered.box.ymax !== 700 || recovered.box.xmax !== 740) {
    throw new Error(`h-w recovery produced wrong ymax/xmax: ${JSON.stringify(recovered.box)}`);
  }

  // Wrapped in markdown fences + preamble — Gemini sometimes does this.
  const fenced = parseBboxResponse(
    'Here is the bbox:\n```json\n[{"box_2d":[10,20,30,40]}]\n```\n'
  );
  if (!fenced || fenced.box.ymin !== 10) {
    throw new Error('fenced bbox must parse');
  }

  // Bare 4-element array (no box_2d wrapper) — also observed.
  const bare = parseBboxResponse('[[50,60,150,160]]');
  if (!bare || bare.box.ymin !== 50 || bare.box.ymax !== 150) {
    throw new Error(`bare 4-array must parse, got ${JSON.stringify(bare)}`);
  }

  // Out-of-range coords must reject (the 0-1000 contract).
  if (parseBboxResponse('[{"box_2d":[100,200,400,1500]}]') !== null) {
    throw new Error('out-of-range coord must reject');
  }
  // Negative coord must reject.
  if (parseBboxResponse('[{"box_2d":[-10,200,400,500]}]') !== null) {
    throw new Error('negative coord must reject');
  }
  // Wrong-length array must reject.
  if (parseBboxResponse('[{"box_2d":[100,200,400]}]') !== null) {
    throw new Error('3-element bbox must reject');
  }
  // Empty array (per the prompt: "If there is no such new person, return []").
  if (parseBboxResponse('[]') !== null) {
    throw new Error('empty array must reject');
  }
  // Aspect-ratio sanity: reject a 1x100 strip (clearly not a face bbox).
  if (parseBboxResponse('[{"box_2d":[100,200,200,201]}]') !== null) {
    throw new Error('extremely tall strip (1px wide) must reject on aspect check');
  }
  // Aspect-ratio sanity: a near-square box must pass.
  const nearSquare = parseBboxResponse('[{"box_2d":[100,200,300,420]}]');
  if (!nearSquare) {
    throw new Error('near-square bbox must pass aspect check');
  }

  // Pure h/w with would-overflow must reject (no silent clamp).
  if (parseBboxResponse('[{"box_2d":[900,900,200,200]}]') !== null) {
    throw new Error('h-w that overflows 1000 must reject');
  }

  // The exact shape that broke run JMWZ6tDz on coffee-break:
  // a 5-element array. The first 4 form a valid box (h-w shape recovered).
  const fiveElement = parseBboxResponse('[{"box_2d":[205,365,345,435,435]}]');
  if (!fiveElement) {
    throw new Error(
      `JMWZ6tDz regression: 5-element bbox must parse using first 4 elements`
    );
  }
  if (!fiveElement.recovered || !fiveElement.recovered.includes('truncated')) {
    throw new Error(
      `5-element bbox must report 'truncated' in recovered tag, got ${JSON.stringify(fiveElement.recovered)}`
    );
  }

  // 6+ elements also tolerated.
  const sixElement = parseBboxResponse('[[100, 200, 400, 500, 999, 999]]');
  if (!sixElement || sixElement.box.ymin !== 100 || sixElement.box.ymax !== 400) {
    throw new Error(
      `6-element bbox must parse using first 4 elements, got ${JSON.stringify(sixElement)}`
    );
  }
  if (sixElement.recovered !== 'truncated') {
    throw new Error(
      `well-formed 6-element bbox must report exactly 'truncated', got ${JSON.stringify(sixElement.recovered)}`
    );
  }

  // Truncation must still reject after truncating if the first 4 are invalid.
  if (parseBboxResponse('[{"box_2d":[1500,200,400,500,999]}]') !== null) {
    throw new Error('5-element bbox with out-of-range first element must still reject');
  }

  // 3-element array (length < 4) must still reject — truncation never
  // synthesises missing data.
  if (parseBboxResponse('[{"box_2d":[100,200,400]}]') !== null) {
    throw new Error('3-element bbox must reject (length < 4 not recoverable)');
  }

  console.log(JSON.stringify({ parseBboxResponseChecks: 'ok' }));
}

async function checkCropComposite() {
  if (isValidCropRect(null) || isValidCropRect({})) {
    throw new Error('isValidCropRect must reject null/empty');
  }
  if (isValidCropRect({ left: -1, top: 0, width: 10, height: 10 })) {
    throw new Error('isValidCropRect must reject negative left');
  }
  if (isValidCropRect({ left: 0, top: 0, width: 0, height: 10 })) {
    throw new Error('isValidCropRect must reject zero width');
  }
  if (!isValidCropRect({ left: 0, top: 0, width: 10, height: 10 })) {
    throw new Error('isValidCropRect must accept a valid rect');
  }

  const base = await sharp({
    create: { width: 200, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();

  const replacement = await sharp({
    create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();

  const cropRect = { left: 50, top: 50, width: 100, height: 100 };

  const cropBuf = await extractCrop({
    image: { mime: 'image/png', buf: base },
    cropRect,
  });
  const cropMeta = await sharp(cropBuf).metadata();
  if (cropMeta.width !== 100 || cropMeta.height !== 100) {
    throw new Error(`extractCrop dims wrong: ${cropMeta.width}x${cropMeta.height}`);
  }

  const composed = await compositeIntoRegion({
    base: { mime: 'image/png', buf: base },
    replacement,
    cropRect,
  });
  const composedMeta = await sharp(composed).metadata();
  if (composedMeta.width !== 200 || composedMeta.height !== 200) {
    throw new Error(`compositeIntoRegion preserved dims wrong: ${composedMeta.width}x${composedMeta.height}`);
  }

  // Sample center of the composited region: should be light (white was
  // pasted), corners should still be black. This proves the helper actually
  // wrote pixels into the right region.
  const { data, info } = await sharp(composed)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelAt = (x, y) => {
    const idx = (y * info.width + x) * info.channels;
    return data[idx];
  };
  if (pixelAt(100, 100) < 200) {
    throw new Error(`center pixel should be bright after composite, got ${pixelAt(100, 100)}`);
  }
  if (pixelAt(5, 5) > 20) {
    throw new Error(`outside-region pixel should remain black, got ${pixelAt(5, 5)}`);
  }

  // Reject invalid cropRect with a clear error rather than a sharp crash.
  let threw = false;
  try {
    await extractCrop({
      image: { mime: 'image/png', buf: base },
      cropRect: { left: 0, top: 0, width: 0, height: 0 },
    });
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error('extractCrop must throw on invalid cropRect');
  }

  console.log(JSON.stringify({ cropCompositeChecks: 'ok' }));
}

function checkForegroundHero() {
  // V4y33gRv water-samples bbox in normalized 0-1 units:
  //   xmin=0.020 xmax=0.180 (w=0.160) -> exceeds 0.13 threshold
  //   ymin=0.100 ymax=0.370 (h=0.270) -> exceeds 0.18 threshold
  // This is the close-up case the user reported. Must flag as hero.
  const heroBox = {
    xMinNorm: 0.02,
    xMaxNorm: 0.18,
    yMinNorm: 0.1,
    yMaxNorm: 0.37,
  };
  if (isForegroundHero(heroBox) !== true) {
    throw new Error('V4y33gRv close-up bbox must flag as foregroundHero');
  }

  // A normal mid-ground face: ~9% wide, ~13% tall (within the 10-14% target).
  const normalBox = {
    xMinNorm: 0.45,
    xMaxNorm: 0.54,
    yMinNorm: 0.3,
    yMaxNorm: 0.43,
  };
  if (isForegroundHero(normalBox) !== false) {
    throw new Error('mid-ground bbox must NOT flag as foregroundHero');
  }

  // Boundary case: exactly at threshold should NOT flag (strict greater-than).
  const atThreshold = {
    xMinNorm: 0,
    xMaxNorm: 0.13,
    yMinNorm: 0,
    yMaxNorm: 0.18,
  };
  if (isForegroundHero(atThreshold) !== false) {
    throw new Error('boundary bbox must NOT flag (strict greater-than)');
  }

  // Width-only over: short-and-wide bbox (rare but possible) must still flag.
  const wideBox = {
    xMinNorm: 0.4,
    xMaxNorm: 0.6,
    yMinNorm: 0.45,
    yMaxNorm: 0.55,
  };
  if (isForegroundHero(wideBox) !== true) {
    throw new Error('wide bbox must flag on width axis alone');
  }

  // Custom thresholds: caller can tighten or loosen.
  if (
    isForegroundHero(normalBox, { widthFrac: 0.05, heightFrac: 0.05 }) !== true
  ) {
    throw new Error('custom-tight thresholds must flag a normal-sized bbox');
  }

  if (isForegroundHero(null) !== false) {
    throw new Error('null normBox must return false');
  }

  console.log(JSON.stringify({ foregroundHeroChecks: 'ok' }));
}

function checkPlaceholderModeContrast() {
  // The prompt-builder is the actual mechanism by which single-pass-gemini's
  // new `faceWillBeSwapped: true` argument changes Gemini's instructions.
  // Assert that the produced text genuinely differs in framing language —
  // not just that two strings are unequal.
  const scene = BOLIDEN_SCENE_LIBRARY['water-samples'];
  const suffixes = {
    qualitySuffix: aspectPreset.qualitySuffix,
    compositeQualitySuffix: aspectPreset.compositeQualitySuffix,
  };

  const strictSlim = buildInsertPrompt(scene, personBrief, suffixes, {
    slim: true,
    aspectId: aspectPreset.id,
  });
  const placeholderSlim = buildInsertPrompt(scene, personBrief, suffixes, {
    slim: true,
    aspectId: aspectPreset.id,
    faceWillBeSwapped: true,
  });

  // Strict mode must include a "match/copy facial geometry" instruction.
  if (!/match facial geometry/i.test(strictSlim.prompt)) {
    throw new Error('strict slim prompt must instruct Gemini to match facial geometry');
  }
  // Placeholder mode must NOT contain that instruction (the whole point is
  // that identity is not Gemini's job in this mode).
  if (/match facial geometry/i.test(placeholderSlim.prompt)) {
    throw new Error('placeholder slim prompt must NOT instruct facial-geometry copy');
  }
  // Placeholder mode must include the explicit placeholder marker so we know
  // the right code path was hit.
  if (!/placeholder — replaced later/i.test(placeholderSlim.prompt)) {
    throw new Error('placeholder slim prompt must include the "placeholder — replaced later" marker');
  }
  // Placeholder mode anchors head-size to existing workers in the scene
  // instead of a frame-height percentage. The existing-worker anchor is more
  // robust against foreground-hero compositions (run i62leYvO regression).
  if (!/NO LARGER than the heads of the existing workers/i.test(placeholderSlim.prompt)) {
    throw new Error('placeholder slim prompt must anchor head size to existing workers in the scene');
  }
  if (!/head ≤ 12%/.test(placeholderSlim.prompt)) {
    throw new Error('placeholder slim prompt must include the absolute 12% head cap');
  }
  // Strict slim still uses a fixed-percentage anchor (6–10%) because there's
  // no swap step downstream that needs the placeholder permissions.
  if (!/6–10%/i.test(strictSlim.prompt)) {
    throw new Error('strict slim prompt must include the 6–10% face-size target');
  }
  // Verify the swap-targeting hint that fueled foreground-hero compositions
  // is gone from BOTH the slim and full placeholder builders.
  if (/Swap targeting hint/i.test(placeholderSlim.prompt)) {
    throw new Error(
      'placeholder slim prompt must not include the swap-targeting hint (drove foreground-hero composition in run i62leYvO)'
    );
  }

  console.log(JSON.stringify({ placeholderModeContrastChecks: 'ok' }));
}

async function main() {
  checkPrompts();
  checkSelector();
  checkFaceRestoreFlags();
  checkTargetedFaceSwapFlags();
  await checkNormalizeImage();
  checkFatalReasonExports();
  checkParseDescribeResponse();
  checkParseBboxResponse();
  await checkCropComposite();
  checkForegroundHero();
  checkPlaceholderModeContrast();
  console.log('smoke ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
