// Execution Mapping Builder — Warning codes.
//
// Warnings are non-fatal. They inform about low confidence, rejected AI
// candidates, or partial coverage.

import type { ExecutionMappingWarningCode } from './models.js';

export const EXECUTION_MAPPING_WARNING_CODES: ReadonlySet<ExecutionMappingWarningCode> = new Set([
  'EMB_NO_PROVIDER',
  'EMB_AI_CANDIDATE_REJECTED',
  'EMB_LOW_CONFIDENCE',
  'EMB_PARTIAL_COVERAGE',
]);

export interface ExecutionMappingWarning {
  code: ExecutionMappingWarningCode;
  message: string;
  testCaseId?: string;
}
