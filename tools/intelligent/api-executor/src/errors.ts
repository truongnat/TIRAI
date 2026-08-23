// API Executor v1 — Error codes and typed error class.

export const ApiErrorCode = {
  API_INVALID_OPERATION: 'API_INVALID_OPERATION',
  API_RESOURCE_DENIED: 'API_RESOURCE_DENIED',
  API_UNSAFE_URL: 'API_UNSAFE_URL',
  API_UNSUPPORTED_PROTOCOL: 'API_UNSUPPORTED_PROTOCOL',
  API_BINDING_MISSING: 'API_BINDING_MISSING',
  API_SECRET_MISSING: 'API_SECRET_MISSING',
  API_TIMEOUT: 'API_TIMEOUT',
  API_NETWORK_ERROR: 'API_NETWORK_ERROR',
  API_RATE_LIMITED: 'API_RATE_LIMITED',
  API_RESPONSE_STATUS: 'API_RESPONSE_STATUS',
  API_RESPONSE_PARSE: 'API_RESPONSE_PARSE',
  API_RESPONSE_MAPPING: 'API_RESPONSE_MAPPING',
  API_REDIRECT_DENIED: 'API_REDIRECT_DENIED',
  API_CLEANUP_FAILED: 'API_CLEANUP_FAILED',
  API_ROLLBACK_UNAVAILABLE: 'API_ROLLBACK_UNAVAILABLE',
  API_UNKNOWN_ERROR: 'API_UNKNOWN_ERROR',
  API_METHOD_UNSUPPORTED: 'API_METHOD_UNSUPPORTED',
  API_HEADER_FORBIDDEN: 'API_HEADER_FORBIDDEN',
  API_BODY_SIZE_EXCEEDED: 'API_BODY_SIZE_EXCEEDED',
  API_MUTATION_DENIED: 'API_MUTATION_DENIED',
  API_MUTATION_UNACKNOWLEDGED: 'API_MUTATION_UNACKNOWLEDGED',
  API_PATH_TRAVERSAL: 'API_PATH_TRAVERSAL',
  API_ORIGIN_MISMATCH: 'API_ORIGIN_MISMATCH',
} as const;

export type ApiErrorCodeType = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export class ApiExecutorError extends Error {
  readonly code: ApiErrorCodeType;
  readonly retryable: boolean;
  readonly operationId?: string;
  readonly statusCode?: number;

  constructor(
    code: ApiErrorCodeType,
    message: string,
    options?: {
      retryable?: boolean;
      operationId?: string;
      statusCode?: number;
    },
  ) {
    super(message);
    this.name = 'ApiExecutorError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.operationId = options?.operationId;
    this.statusCode = options?.statusCode;
  }
}
