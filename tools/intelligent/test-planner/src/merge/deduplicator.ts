// ---------------------------------------------------------------------------
// Deduplicator – deterministic deduplication of test artifacts
// ---------------------------------------------------------------------------

import type {
  ScenarioCandidate,
  TestCaseCandidate,
  TestPlannerWarning,
} from '../models.js';
import { TestPlannerWarningCode } from '../warnings.js';

/**
 * Deduplicate scenario candidates based on title + requirement IDs.
 *
 * When duplicates are found, keep the one with higher confidence.
 */
export function deduplicateScenarios(
  scenarios: ScenarioCandidate[],
): { deduped: ScenarioCandidate[]; warnings: TestPlannerWarning[] } {
  const warnings: TestPlannerWarning[] = [];
  const seen = new Map<string, number>(); // key → index in result
  const result: ScenarioCandidate[] = [];

  for (const s of scenarios) {
    const key = buildScenarioKey(s);
    const existingIdx = seen.get(key);

    if (existingIdx !== undefined) {
      const existing = result[existingIdx]!;
      // Keep the one with higher confidence
      if (s.confidence > existing.confidence) {
        warnings.push({
          code: TestPlannerWarningCode.CASE_DUPLICATE,
          message: `Duplicate scenario "${existing.temporaryId}" replaced by "${s.temporaryId}" (higher confidence)`,
          scenarioId: s.temporaryId,
        });
        result[existingIdx] = s;
      } else {
        warnings.push({
          code: TestPlannerWarningCode.CASE_DUPLICATE,
          message: `Duplicate scenario "${s.temporaryId}" removed (lower confidence)`,
          scenarioId: s.temporaryId,
        });
      }
    } else {
      seen.set(key, result.length);
      result.push(s);
    }
  }

  return { deduped: result, warnings };
}

/**
 * Deduplicate test case candidates based on title + scenario + requirement IDs.
 */
export function deduplicateTestCases(
  testCases: TestCaseCandidate[],
): { deduped: TestCaseCandidate[]; warnings: TestPlannerWarning[] } {
  const warnings: TestPlannerWarning[] = [];
  const seen = new Map<string, number>();
  const result: TestCaseCandidate[] = [];

  for (const tc of testCases) {
    const key = buildTestCaseKey(tc);
    const existingIdx = seen.get(key);

    if (existingIdx !== undefined) {
      const existing = result[existingIdx]!;
      if (tc.confidence > existing.confidence) {
        warnings.push({
          code: TestPlannerWarningCode.CASE_DUPLICATE,
          message: `Duplicate test case "${existing.temporaryId}" replaced by "${tc.temporaryId}" (higher confidence)`,
          testCaseId: tc.temporaryId,
        });
        result[existingIdx] = tc;
      } else {
        warnings.push({
          code: TestPlannerWarningCode.CASE_DUPLICATE,
          message: `Duplicate test case "${tc.temporaryId}" removed (lower confidence)`,
          testCaseId: tc.temporaryId,
        });
      }
    } else {
      seen.set(key, result.length);
      result.push(tc);
    }
  }

  return { deduped: result, warnings };
}

// ---- Key builders ---------------------------------------------------------

function buildScenarioKey(s: ScenarioCandidate): string {
  const sortedReqIds = [...s.requirementIds].sort().join(',');
  return `${s.title.toLowerCase().trim()}|${s.category}|${sortedReqIds}`;
}

function buildTestCaseKey(tc: TestCaseCandidate): string {
  const sortedReqIds = [...tc.requirementIds].sort().join(',');
  return `${tc.scenarioTemporaryId}|${tc.title.toLowerCase().trim()}|${sortedReqIds}`;
}
