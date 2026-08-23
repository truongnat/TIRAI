// ---------------------------------------------------------------------------
// Data Resolver – warning codes
// ---------------------------------------------------------------------------

export const DataResolverWarningCode = {
  NO_COMPATIBLE_RESOLVER: 'RESOLVER_NO_COMPATIBLE',
  RESOURCE_NOT_FOUND: 'RESOLVER_RESOURCE_NOT_FOUND',
  AMBIGUOUS_RESOURCE: 'RESOLVER_AMBIGUOUS_RESOURCE',
  MISSING_MAPPING: 'RESOLVER_MISSING_MAPPING',
  MISSING_CONSTRAINT: 'RESOLVER_MISSING_CONSTRAINT',
  MANUAL_FALLBACK: 'RESOLVER_MANUAL_FALLBACK',
  UNKNOWN_BINDING: 'RESOLVER_UNKNOWN_BINDING',
  DUPLICATE_BINDING: 'RESOLVER_DUPLICATE_BINDING',
  PARTIAL_RESOLUTION: 'RESOLVER_PARTIAL_RESOLUTION',
} as const;

export type DataResolverWarningCodeKey =
  (typeof DataResolverWarningCode)[keyof typeof DataResolverWarningCode];
