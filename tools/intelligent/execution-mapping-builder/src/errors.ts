// Execution Mapping Builder — Error codes and error class.
//
// All error codes are deterministic and traceable. AI cannot suppress errors.

import type { ExecutionMappingErrorCode } from './models.js';

export const EXECUTION_MAPPING_ERROR_CODES: ReadonlySet<ExecutionMappingErrorCode> = new Set([
  'EMB_INVALID_TEST_CASE',
  'EMB_MISSING_CATALOG',
  'EMB_AMBIGUOUS_TARGET',
  'EMB_MISSING_BINDING',
  'EMB_UNSUPPORTED_ACTION',
  'EMB_UNSUPPORTED_ASSERTION',
  'EMB_PROVIDER_FAILED',
  'EMB_SCHEMA_INVALID',
  'EMB_CHECKPOINT_CORRUPT',
  'EMB_DUPLICATE_MAPPING',
]);

export class ExecutionMappingError extends Error {
  readonly code: ExecutionMappingErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ExecutionMappingErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ExecutionMappingError';
    this.code = code;
    this.details = details;
  }
}
