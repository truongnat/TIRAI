// UI Executor v1 — Execution mapping validator.
//
// Validates TestExecutionMapping structures. Ensures step/assertion mappings
// reference valid test case data and catalog elements.

import type {
  TestExecutionMapping,
  UIStepMapping,
  UIAssertionMapping,
  TestCase,
} from '../models.js';
import type { LocatorResolver } from '../catalog/index.js';

export interface MappingValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class MappingValidator {
  private resolver: LocatorResolver;

  constructor(resolver: LocatorResolver) {
    this.resolver = resolver;
  }

  validateMapping(mapping: TestExecutionMapping, testCase?: TestCase): MappingValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Test case ID required
    if (!mapping.testCaseId) {
      errors.push('TestExecutionMapping.testCaseId is required.');
    }

    // Executor type must be 'ui'
    if (mapping.executorType !== 'ui') {
      errors.push(`TestExecutionMapping.executorType must be 'ui', got '${mapping.executorType}'.`);
    }

    // Page ID must exist in catalog if specified
    if (mapping.pageId) {
      const page = this.resolver.getPage(mapping.pageId);
      if (!page) {
        errors.push(`Page '${mapping.pageId}' not found in catalog.`);
      }
    }

    // Validate step mappings
    const stepOrders = new Set<number>();
    for (const sm of mapping.stepMappings) {
      if (stepOrders.has(sm.stepOrder)) {
        errors.push(`Duplicate step mapping for order ${sm.stepOrder}.`);
      }
      stepOrders.add(sm.stepOrder);
      this.validateStepMapping(sm, errors, warnings);
    }

    // Validate assertion mappings
    const assertionIndexes = new Set<number>();
    for (const am of mapping.assertionMappings) {
      if (assertionIndexes.has(am.expectedResultIndex)) {
        errors.push(`Duplicate assertion mapping for expectedResultIndex ${am.expectedResultIndex}.`);
      }
      assertionIndexes.add(am.expectedResultIndex);
      this.validateAssertionMapping(am, errors, warnings);
    }

    // Cross-check with test case if provided
    if (testCase) {
      for (const sm of mapping.stepMappings) {
        const step = testCase.steps.find((s) => s.order === sm.stepOrder);
        if (!step) {
          warnings.push(`Step mapping order ${sm.stepOrder} has no matching test step.`);
        }
      }
      for (const am of mapping.assertionMappings) {
        if (am.expectedResultIndex < 0 || am.expectedResultIndex >= testCase.expectedResults.length) {
          errors.push(`Assertion mapping index ${am.expectedResultIndex} out of range (0..${testCase.expectedResults.length - 1}).`);
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  private validateStepMapping(sm: UIStepMapping, errors: string[], _warnings: string[]): void {
    if (!sm.action) {
      errors.push(`Step mapping order ${sm.stepOrder}: action is required.`);
    }
    if (sm.targetLogicalName) {
      const found = this.resolver.findElement(sm.targetLogicalName);
      if (!found) {
        errors.push(`Step mapping order ${sm.stepOrder}: element '${sm.targetLogicalName}' not in catalog.`);
      }
    }
  }

  private validateAssertionMapping(am: UIAssertionMapping, errors: string[], _warnings: string[]): void {
    if (!am.assertionType) {
      errors.push(`Assertion mapping index ${am.expectedResultIndex}: assertionType is required.`);
    }
    if (am.targetLogicalName) {
      const found = this.resolver.findElement(am.targetLogicalName);
      if (!found) {
        errors.push(`Assertion mapping index ${am.expectedResultIndex}: element '${am.targetLogicalName}' not in catalog.`);
      }
    }
  }

  // Find mapping for a test case ID
  static findMapping(mappings: TestExecutionMapping[], testCaseId: string): TestExecutionMapping | null {
    return mappings.find((m) => m.testCaseId === testCaseId) ?? null;
  }
}
