// ---------------------------------------------------------------------------
// Test Data Planner – reference validators
// ---------------------------------------------------------------------------

import type { TestDataPlannerWarning } from '../models.js';
import { TestDataPlannerWarningCode } from '../warnings.js';

/**
 * Validate that all test case references in data items point to valid test case IDs.
 */
export function validateTestCaseReferences(
  dataItems: Array<{ id: string; relatedTestCaseIds: string[] }>,
  validTestCaseIds: Set<string>,
): TestDataPlannerWarning[] {
  const warnings: TestDataPlannerWarning[] = [];

  for (const item of dataItems) {
    for (const tcId of item.relatedTestCaseIds) {
      if (!validTestCaseIds.has(tcId)) {
        warnings.push({
          code: TestDataPlannerWarningCode.INVALID_REFERENCE,
          message: `Data item ${item.id} references invalid test case ${tcId}`,
          dataItemId: item.id,
          testCaseId: tcId,
        });
      }
    }
  }

  return warnings;
}

/**
 * Validate that all requirement references in data items point to valid requirement IDs.
 */
export function validateRequirementReferences(
  dataItems: Array<{ id: string; relatedRequirementIds: string[] }>,
  validRequirementIds: Set<string>,
): TestDataPlannerWarning[] {
  const warnings: TestDataPlannerWarning[] = [];

  for (const item of dataItems) {
    for (const reqId of item.relatedRequirementIds) {
      if (!validRequirementIds.has(reqId)) {
        warnings.push({
          code: TestDataPlannerWarningCode.INVALID_REFERENCE,
          message: `Data item ${item.id} references invalid requirement ${reqId}`,
          dataItemId: item.id,
        });
      }
    }
  }

  return warnings;
}

/**
 * Validate provenance coverage – warn for data items with no provenance.
 */
export function validateProvenance(
  dataItems: Array<{ id: string; provenance: unknown[] }>,
): TestDataPlannerWarning[] {
  const warnings: TestDataPlannerWarning[] = [];

  for (const item of dataItems) {
    if (item.provenance.length === 0) {
      warnings.push({
        code: TestDataPlannerWarningCode.MISSING_PROVENANCE,
        message: `Data item ${item.id} has no provenance`,
        dataItemId: item.id,
      });
    }
  }

  return warnings;
}
