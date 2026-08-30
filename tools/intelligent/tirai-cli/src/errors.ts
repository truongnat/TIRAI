// CLI error taxonomy — maps to exit codes 2 (blocked/config) vs 1 (fail) vs 0 (pass).

export type CliErrorCode =
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_ALREADY_EXISTS'
  | 'CONFIG_INVALID'
  | 'CONFIG_VERSION_UNSUPPORTED'
  | 'SOURCE_INPUT_ERROR'
  | 'SOURCE_NOT_FOUND'
  | 'PIPELINE_ERROR'
  | 'MAPPING_MISSING'
  | 'MAPPING_BLOCKED'
  | 'STALE_MAPPING'
  | 'VALIDATION_ERROR'
  | 'GENERATION_BLOCKED'
  | 'NO_TESTS_DISCOVERED'
  | 'INFRA_ERROR'
  | 'EXECUTION_ERROR';

export class CliError extends Error {
  constructor(
    public readonly code: CliErrorCode,
    message: string,
    public readonly hint?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function exitCodeForError(code: CliErrorCode): number {
  // 2 = blocked/config/infra, 1 = business fail (handled separately in run)
  switch (code) {
    case 'WORKSPACE_NOT_FOUND':
    case 'WORKSPACE_ALREADY_EXISTS':
    case 'CONFIG_INVALID':
    case 'CONFIG_VERSION_UNSUPPORTED':
    case 'SOURCE_INPUT_ERROR':
    case 'SOURCE_NOT_FOUND':
    case 'PIPELINE_ERROR':
    case 'MAPPING_MISSING':
    case 'MAPPING_BLOCKED':
    case 'STALE_MAPPING':
    case 'VALIDATION_ERROR':
    case 'GENERATION_BLOCKED':
    case 'NO_TESTS_DISCOVERED':
    case 'INFRA_ERROR':
    case 'EXECUTION_ERROR':
      return 2;
    default:
      return 2;
  }
}
