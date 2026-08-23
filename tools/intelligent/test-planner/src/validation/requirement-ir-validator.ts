// ---------------------------------------------------------------------------
// Requirement IR validator – checks requirement ID references
// ---------------------------------------------------------------------------

import type { RequirementIRInput, TestPlannerWarning } from '../models.js';
import { TestPlannerWarningCode } from '../warnings.js';

/**
 * Build the set of valid requirement IDs from the Requirement IR.
 */
export function buildValidRequirementIds(ir: RequirementIRInput): Set<string> {
  return new Set(ir.requirements.map((r) => r.id));
}

/**
 * Validate that all requirement ID references in test artifacts are valid.
 */
export function validateRequirementReferences(
  referencedIds: string[],
  validIds: Set<string>,
  artifactId: string,
  artifactType: string,
): TestPlannerWarning[] {
  const warnings: TestPlannerWarning[] = [];

  for (const id of referencedIds) {
    if (!validIds.has(id)) {
      warnings.push({
        code: TestPlannerWarningCode.CASE_DANGLING_REQUIREMENT,
        message: `${artifactType} ${artifactId} references unknown requirement "${id}"`,
        testCaseId: artifactType === 'test-case' ? artifactId : undefined,
        scenarioId: artifactType === 'scenario' ? artifactId : undefined,
      });
    }
  }

  return warnings;
}

/**
 * Check if a test case has at least one valid requirement reference.
 */
export function hasValidRequirementReference(
  referencedIds: string[],
  validIds: Set<string>,
): boolean {
  return referencedIds.some((id) => validIds.has(id));
}
