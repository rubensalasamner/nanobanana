// Smoke test: verify prompt builders render, strategy selector picks the
// right strategy under various env/scene combinations, and there are no
// import cycles. Run with: `node scripts/smoke-strategies.mjs`

import { BOLIDEN_SCENE_LIBRARY, COMPANY_IDS } from '../public/shared/company-scenes.js';
import { buildInsertPrompt } from '../public/shared/boliden/index.js';
import { defaultStrategy, faceSwapOnlyStrategy, selectStrategy, STRATEGIES } from '../api/strategies/index.js';
import { getOutputAspectPreset } from '../public/shared/output-aspect.js';
import {
  isFaceRestoreEnabled,
  resolveCodeformerFidelity,
} from '../api/faceRestore.js';
import { isFaceDetectEnabled } from '../api/faceDetect.js';
import { isTargetedFaceSwapAvailable } from '../api/targetedFaceSwap.js';

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
    if (!placeholder.prompt.includes('10–14%')) {
      throw new Error(`placeholder insert prompt missing 10–14% face-size target for ${scene.id}`);
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
    if (!slimPlaceholder.prompt.includes('10–14%')) {
      throw new Error(`slim placeholder missing 10–14% face-size target for ${scene.id}`);
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

  const swapOnlyScene = BOLIDEN_SCENE_LIBRARY['coworker-with-machine'];
  const bolidenSwapOnly = selectStrategy({
    ...ctxBase,
    clientMode: 'mobile',
    company: COMPANY_IDS.BOLIDEN,
    sceneId: swapOnlyScene.id,
    scene: swapOnlyScene,
    pipeline: 'swap-only',
  });
  if (bolidenSwapOnly?.name !== faceSwapOnlyStrategy.name) {
    throw new Error(
      `pipeline=swap-only should choose ${faceSwapOnlyStrategy.name}, got ${bolidenSwapOnly?.name}`
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

checkPrompts();
checkSelector();
checkFaceRestoreFlags();
checkTargetedFaceSwapFlags();
console.log('smoke ok');
