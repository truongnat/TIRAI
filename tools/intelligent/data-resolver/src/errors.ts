// ---------------------------------------------------------------------------
// Data Resolver – error codes
// ---------------------------------------------------------------------------

export const DataResolverErrorCode = {
  INPUT_NOT_FOUND: 'RESOLVER_INPUT_NOT_FOUND',
  INVALID_DATA_PLAN: 'RESOLVER_INVALID_DATA_PLAN',
  ENVIRONMENT_NOT_FOUND: 'RESOLVER_ENVIRONMENT_NOT_FOUND',
  RESOLUTION_FAILURE: 'RESOLVER_RESOLUTION_FAILURE',
  CYCLE_DETECTED: 'RESOLVER_CYCLE_DETECTED',
  TRACEABILITY_FAILURE: 'RESOLVER_TRACEABILITY_FAILURE',
} as const;

export type DataResolverErrorCodeKey =
  (typeof DataResolverErrorCode)[keyof typeof DataResolverErrorCode];

export class DataResolverError extends Error {
  public readonly code: DataResolverErrorCodeKey;
  public override readonly cause?: unknown;

  constructor(code: DataResolverErrorCodeKey, message: string, cause?: unknown) {
    super(message);
    this.name = 'DataResolverError';
    this.code = code;
    this.cause = cause;
  }
}
