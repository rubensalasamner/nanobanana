// Public surface of the Boliden prompt subsystem.
// Re-exports the individual prompt blocks, prompt builders, and the
// identity-description helper so callers don't need to know the internal
// module split.

export {
  buildIdentityLockBlock,
  describePersonAppearance,
  parseDescribeResponse,
  parseHairLength,
} from './identity.js';
export { buildSceneIntegrationBlock, buildVisualIntegrationBlock } from './scene.js';
export { buildConstraintsBlock } from './constraints.js';
export { buildInsertPrompt } from './prompt-insert.js';
