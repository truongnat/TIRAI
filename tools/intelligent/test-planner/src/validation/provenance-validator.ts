// ---------------------------------------------------------------------------
// Provenance validator – checks test provenance references
// ---------------------------------------------------------------------------

import type { TestProvenance, TestPlannerWarning, RequirementIRInput } from '../models.js';
import { TestPlannerWarningCode } from '../warnings.js';

/**
 * Validate test provenance against known valid requirement IDs.
 */
export function validateTestProvenance(
  provenance: TestProvenance[],
  validRequirementIds: Set<string>,
  artifactId: string,
): TestPlannerWarning[] {
  const warnings: TestPlannerWarning[] = [];

  for (const p of provenance) {
    if (!p.requirementId || !validRequirementIds.has(p.requirementId)) {
      warnings.push({
        code: TestPlannerWarningCode.CASE_INVALID_PROVENANCE,
        message: `${artifactId}: provenance references unknown requirement "${p.requirementId}"`,
        testCaseId: artifactId,
      });
    }
  }

  return warnings;
}

/**
 * Build the set of valid context IDs from Requirement IR provenance.
 */
export function buildValidContextIdsFromRequirementIR(ir: RequirementIRInput): Set<string> {
  const ids = new Set<string>();

  const collect = (provenance: Array<{ contextId: string }>): void => {
    for (const p of provenance) {
      if (p.contextId) ids.add(p.contextId);
    }
  };

  collect(ir.document.provenance);
  for (const req of ir.requirements) {
    collect(req.provenance);
    for (const pre of req.preconditions) collect(pre.provenance);
    for (const inp of req.inputs) collect(inp.provenance);
    for (const eb of req.expectedBehaviors) collect(eb.provenance);
    for (const oc of req.outcomes) collect(oc.provenance);
    for (const ct of req.constraints) collect(ct.provenance);
  }
  for (const u of ir.unresolved) collect(u.provenance);
  for (const c of ir.conflicts) collect(c.provenance);

  return ids;
}

/**
 * Check if a provenance array has at least one non-empty reference.
 */
export function hasProvenance(provenance: TestProvenance[]): boolean {
  return provenance.length > 0 && provenance.some((p) => p.requirementId.length > 0);
}
