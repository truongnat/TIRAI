// Execution Mapping Builder — Warning codes.
//
// Warnings are non-fatal. They inform about low confidence or partial coverage.

import type { ExecutionMappingWarningCode } from './models.js';

export const EXECUTION_MAPPING_WARNING_CODES: ReadonlySet<ExecutionMappingWarningCode> = new Set([
  'EMB_LOW_CONFIDENCE',
  'EMB_PARTIAL_COVERAGE',
]);

export interface ExecutionMappingWarning {
  code: ExecutionMappingWarningCode;
  message: string;
  testCaseId?: string;
}
