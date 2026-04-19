// Smoke test: verify prompt builders render, strategy selector picks the
// right strategy under various env/scene combinations, and there are no
// import cycles. Run with: `node scripts/smoke-strategies.mjs`

import { BOLIDEN_SCENE_LIBRARY, COMPANY_IDS } from '../public/shared/company-scenes.js';
import { buildInsertPrompt } from '../public/shared/boliden/index.js';
import { defaultStrategy, selectStrategy, STRATEGIES } from '../api/strategies/index.js';
import { getOutputAspectPreset } from '../public/shared/output-aspect.js';

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

    console.log(
      JSON.stringify({
        scene: scene.id,
        replaceReferenceSubject: scene.replaceReferenceSubject === true,
        insertLen: insert.prompt.length,
        insertFallbackLen: insert.fallbackPrompt.length,
        placeholderLen: placeholder.prompt.length,
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

checkPrompts();
checkSelector();
console.log('smoke ok');
