// Execution Mapping Builder — Deterministic validation.
//
// Validates mapping candidates against trusted catalogs. AI cannot override
// validation. A mapping is only "ready" when ALL required parts are validated.

import type {
  TestCase,
  ExecutorCandidate,
  TestCaseExecutionMapping,
  ExecutionMappingUnresolved,
  MappingStatus,
  MappingSource,
  TestExecutionMapping,
  UIStepMapping,
  UIAssertionMapping,
} from '../models.js';
import type { UICatalogResolver } from '../catalog/catalog.js';
import type { BindingResolver } from '../bindings/bindings.js';
import { isSupportedAction, isSupportedAssertion } from '../candidates/candidates.js';

// ---- Validation result -----------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  status: MappingStatus;
  mapping?: TestCaseExecutionMapping;
  unresolved: ExecutionMappingUnresolved[];
  errors: string[];
}

// ---- Validate a UI mapping candidate ---------------------------------------

export function validateUICandidate(
  testCase: TestCase,
  candidate: ExecutorCandidate,
  catalog: UICatalogResolver,
  bindings: BindingResolver,
): ValidationResult {
  const unresolved: ExecutionMappingUnresolved[] = [];
  const errors: string[] = [];
  let unresolvedCounter = 0;

  const makeUnresolvedId = (): string => {
    unresolvedCounter++;
    return `MAP-UNRESOLVED-${String(unresolvedCounter).padStart(4, '0')}`;
  };

  // Validate page
  let pageId: string | undefined;
  if (candidate.pageLogicalName) {
    const page = catalog.findPage(candidate.pageLogicalName);
    if (page) {
      pageId = page.id;
    } else {
      unresolved.push({
        id: makeUnresolvedId(),
        testCaseId: testCase.id,
        stage: 'page',
        description: `Page '${candidate.pageLogicalName}' not found in catalog`,
        reason: 'missing-catalog-entry',
        provenance: testCase.provenance,
      });
    }
  }

  // Validate step candidates
  const validSteps: UIStepMapping[] = [];
  const stepOrders = new Set<number>();

  for (const step of candidate.stepCandidates) {
    // Check for duplicate step order
    if (stepOrders.has(step.stepOrder)) {
      errors.push(`Duplicate step order: ${step.stepOrder}`);
      continue;
    }
    stepOrders.add(step.stepOrder);

    // Validate action
    if (!isSupportedAction(step.action)) {
      unresolved.push({
        id: makeUnresolvedId(),
        testCaseId: testCase.id,
        stage: 'step',
        description: `Unsupported action '${step.action}' for step ${step.stepOrder}`,
        reason: 'unsupported-action',
        provenance: testCase.provenance,
      });
      continue;
    }

    // Validate target
    if (step.targetLogicalName && step.action !== 'navigate' && step.action !== 'noop') {
      const lookup = catalog.lookup(step.targetLogicalName);
      if (!lookup.found) {
        unresolved.push({
          id: makeUnresolvedId(),
          testCaseId: testCase.id,
          stage: 'target',
          description: `Target '${step.targetLogicalName}' not found in catalog`,
          reason: 'missing-catalog-entry',
          provenance: testCase.provenance,
        });
        continue;
      }
      if (lookup.ambiguous) {
        unresolved.push({
          id: makeUnresolvedId(),
          testCaseId: testCase.id,
          stage: 'target',
          description: `Target '${step.targetLogicalName}' is ambiguous`,
          reason: 'ambiguous-target',
          provenance: testCase.provenance,
        });
        continue;
      }
    }

    // Validate binding
    if (step.valueBinding) {
      const bindingCheck = bindings.validateBinding(step.valueBinding);
      if (!bindingCheck.valid) {
        unresolved.push({
          id: makeUnresolvedId(),
          testCaseId: testCase.id,
          stage: 'binding',
          description: bindingCheck.reason ?? `Binding '${step.valueBinding}' not found`,
          reason: 'missing-binding',
          provenance: testCase.provenance,
        });
        continue;
      }
    }

    // Build valid step mapping
    const mapping: UIStepMapping = {
      stepOrder: step.stepOrder,
      action: step.action,
    };
    if (step.targetLogicalName) mapping.targetLogicalName = step.targetLogicalName;
    if (step.valueBinding) mapping.valueBinding = step.valueBinding;
    if (step.valueLiteral) mapping.valueLiteral = step.valueLiteral;
    if (step.secretRef) mapping.secretRef = step.secretRef;
    validSteps.push(mapping);
  }

  // Validate assertion candidates
  const validAssertions: UIAssertionMapping[] = [];
  const assertionIndexes = new Set<number>();

  for (const assertion of candidate.assertionCandidates) {
    // Check for duplicate index
    if (assertionIndexes.has(assertion.expectedResultIndex)) {
      errors.push(`Duplicate assertion index: ${assertion.expectedResultIndex}`);
      continue;
    }
    assertionIndexes.add(assertion.expectedResultIndex);

    // Validate assertion type
    if (!isSupportedAssertion(assertion.assertionType)) {
      unresolved.push({
        id: makeUnresolvedId(),
        testCaseId: testCase.id,
        stage: 'assertion',
        description: `Unsupported assertion type '${assertion.assertionType}'`,
        reason: 'unsupported-assertion',
        provenance: testCase.provenance,
      });
      continue;
    }

    // Validate target
    if (assertion.targetLogicalName) {
      const lookup = catalog.lookup(assertion.targetLogicalName);
      if (!lookup.found) {
        unresolved.push({
          id: makeUnresolvedId(),
          testCaseId: testCase.id,
          stage: 'target',
          description: `Assertion target '${assertion.targetLogicalName}' not found`,
          reason: 'missing-catalog-entry',
          provenance: testCase.provenance,
        });
        continue;
      }
    }

    // Build valid assertion mapping
    const mapping: UIAssertionMapping = {
      expectedResultIndex: assertion.expectedResultIndex,
      assertionType: assertion.assertionType,
    };
    if (assertion.targetLogicalName) mapping.targetLogicalName = assertion.targetLogicalName;
    if (assertion.expectedValue) mapping.expectedValue = assertion.expectedValue;
    validAssertions.push(mapping);
  }

  // Determine status
  const allStepsMapped = validSteps.length === testCase.steps.length;
  const allAssertionsMapped = validAssertions.length === testCase.expectedResults.length;
  const hasUnresolved = unresolved.length > 0;

  let status: MappingStatus;
  if (!hasUnresolved && allStepsMapped && allAssertionsMapped) {
    status = 'ready';
  } else if (validSteps.length > 0 || validAssertions.length > 0) {
    status = 'partial';
  } else {
    status = 'unresolved';
  }

  // Build final mapping if we have any valid parts
  let mapping: TestCaseExecutionMapping | undefined;
  if (validSteps.length > 0 || validAssertions.length > 0 || status === 'partial') {
    const uiMapping: TestExecutionMapping = {
      testCaseId: testCase.id,
      executorType: 'ui',
      stepMappings: validSteps,
      assertionMappings: validAssertions,
    };
    if (pageId) uiMapping.pageId = pageId;

    const source: MappingSource[] = [
      { type: 'code-derived', reference: `deterministic:${testCase.id}` },
    ];

    mapping = {
      testCaseId: testCase.id,
      executorType: 'ui',
      confidence: candidate.confidence,
      status,
      source,
      ui: uiMapping,
      unresolvedIds: unresolved.map(u => u.id),
      provenance: testCase.provenance,
    };
  }

  return {
    valid: !hasUnresolved,
    status,
    mapping,
    unresolved,
    errors,
  };
}

// ---- Validate all candidates -----------------------------------------------

export function validateAllCandidates(
  testCases: TestCase[],
  candidates: ExecutorCandidate[],
  catalog: UICatalogResolver,
  bindings: BindingResolver,
): { mappings: TestCaseExecutionMapping[]; allUnresolved: ExecutionMappingUnresolved[] } {
  const mappings: TestCaseExecutionMapping[] = [];
  const allUnresolved: ExecutionMappingUnresolved[] = [];
  let unresolvedCounter = 0;

  const candidateMap = new Map(candidates.map(c => [c.testCaseId, c]));

  for (const tc of testCases) {
    const candidate = candidateMap.get(tc.id);
    if (!candidate) {
      // No candidate — mark as unresolved
      unresolvedCounter++;
      allUnresolved.push({
        id: `MAP-UNRESOLVED-${String(unresolvedCounter).padStart(4, '0')}`,
        testCaseId: tc.id,
        stage: 'executor',
        description: `No mapping candidate for test case ${tc.id}`,
        reason: 'insufficient-evidence',
        provenance: tc.provenance,
      });
      continue;
    }

    if (candidate.executorType === 'ui') {
      const result = validateUICandidate(tc, candidate, catalog, bindings);
      if (result.mapping) mappings.push(result.mapping);
      allUnresolved.push(...result.unresolved);
      unresolvedCounter += result.unresolved.length;
    } else if (candidate.executorType === 'unknown') {
      unresolvedCounter++;
      allUnresolved.push({
        id: `MAP-UNRESOLVED-${String(unresolvedCounter).padStart(4, '0')}`,
        testCaseId: tc.id,
        stage: 'executor',
        description: `Executor type unknown for test case ${tc.id}`,
        reason: 'insufficient-evidence',
        provenance: tc.provenance,
      });
    } else if (candidate.executorType === 'api' || candidate.executorType === 'database') {
      // For API/DB, create placeholder mapping with unresolved status
      unresolvedCounter++;
      allUnresolved.push({
        id: `MAP-UNRESOLVED-${String(unresolvedCounter).padStart(4, '0')}`,
        testCaseId: tc.id,
        stage: 'resource',
        description: `${candidate.executorType} executor mapping not yet fully validated`,
        reason: 'other',
        provenance: tc.provenance,
      });
    }
  }

  return { mappings, allUnresolved };
}
