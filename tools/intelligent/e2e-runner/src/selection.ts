// Test selection — deterministic filtering and ordering (spec §25-27).
//
// Supports filtering by test case ID, scenario, requirement, tag, executor type.
// Default ordering: test case ID (deterministic).

import type {
  TestCase,
  TestSelection,
} from './models.js';

export function selectTests(
  testCases: TestCase[],
  selection?: TestSelection,
): TestCase[] {
  if (!selection) return sortByTestId(testCases);

  let filtered = [...testCases];

  if (selection.testCaseIds?.length) {
    const ids = new Set(selection.testCaseIds);
    filtered = filtered.filter((tc) => ids.has(tc.id));
  }

  if (selection.scenarioIds?.length) {
    const ids = new Set(selection.scenarioIds);
    filtered = filtered.filter((tc) => ids.has(tc.scenarioId));
  }

  if (selection.requirementIds?.length) {
    const ids = new Set(selection.requirementIds);
    filtered = filtered.filter((tc) =>
      tc.provenance?.some((p) => ids.has(p.requirementId)),
    );
  }

  // Tags filter: TestCase has no tags field in v1 — skip.

  // Executor-type filter: resolve via mapping executor classification.
  // TestCase itself does not carry executor type; we accept all when no
  // mapping context is available (runner-level filtering applies later).

  return sortByTestId(filtered);
}

export function sortByTestId(testCases: TestCase[]): TestCase[] {
  return [...testCases].sort((a, b) => a.id.localeCompare(b.id));
}

export function applyMaxTests(
  testCases: TestCase[],
  maxTests?: number,
): TestCase[] {
  if (maxTests === undefined || maxTests <= 0) return testCases;
  return testCases.slice(0, maxTests);
}
