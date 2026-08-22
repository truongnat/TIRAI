// ---------------------------------------------------------------------------
// Quality metrics – aggregate requirement quality statistics
// ---------------------------------------------------------------------------

import type {
  Requirement,
  RequirementUnresolved,
  RequirementConflict,
  RequirementQualityMetrics,
} from '../models.js';
import { CONFIDENCE_THRESHOLD } from '../warnings.js';

/**
 * Compute aggregate quality metrics for the final Requirement IR.
 */
export function computeQualityMetrics(
  requirements: Requirement[],
  unresolved: RequirementUnresolved[],
  conflicts: RequirementConflict[],
): RequirementQualityMetrics {
  let explicit = 0;
  let derived = 0;
  let testable = 0;
  let partiallyTestable = 0;
  let notTestable = 0;
  let unknownTestability = 0;
  let lowConfidence = 0;
  let withProvenance = 0;

  for (const req of requirements) {
    if (req.sourceNature === 'explicit') explicit++;
    else if (req.sourceNature === 'derived') derived++;

    switch (req.testability.status) {
      case 'testable': testable++; break;
      case 'partially-testable': partiallyTestable++; break;
      case 'not-testable': notTestable++; break;
      default: unknownTestability++; break;
    }

    if (req.confidence < CONFIDENCE_THRESHOLD.MEDIUM) lowConfidence++;
    if (req.provenance.length > 0) withProvenance++;
  }

  const provenanceCoverage = requirements.length > 0
    ? Math.round((withProvenance / requirements.length) * 100) / 100
    : 1;

  return {
    total: requirements.length,
    explicit,
    derived,
    testable,
    partiallyTestable,
    notTestable,
    unknownTestability,
    lowConfidence,
    unresolved: unresolved.length,
    conflicts: conflicts.length,
    provenanceCoverage,
  };
}
