// ---------------------------------------------------------------------------
// Normalization module — provider compatibility + post-processing
// ---------------------------------------------------------------------------

export { adaptDataRequirementRaw, adaptDependencyRaw } from './provider-compat.js';
export { classifyConstraintType, classifyConstraints, extractNumericValue } from './constraint-classifier.js';
export {
  buildTestCaseProvenanceMap,
  inheritProvenance,
  applyProvenanceInheritance,
} from './provenance-inheritance.js';
