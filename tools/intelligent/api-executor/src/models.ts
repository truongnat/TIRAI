// API Executor v1 — Models
// Canonical types for safe HTTP preparation operations.

import type {
  PreparationExecutor,
  PreparationOperation,
  ExecutionContext,
  ExecutionPolicy,
  OperationExecutionResult,
  ExecutionErrorResult,
  RuntimeBindingStore,
  RuntimeBindingResult,
  SecretProvider,
  SecretValue,
  AuditRecorder,
  ExecutorMatch,
  ValidationResult,
  ExecutorType,
} from 'execution-engine';
import type {
  ApiPreparationSpec,
  EnvironmentProfile,
  ResourceMapping,
  DataValueExpression,
  PreparationAction,
} from 'data-resolver';
import type { DataConstraint, TestProvenance } from 'test-data-planner';

export type {
  PreparationExecutor,
  PreparationOperation,
  ExecutionContext,
  ExecutionPolicy,
  OperationExecutionResult,
  ExecutionErrorResult,
  RuntimeBindingStore,
  RuntimeBindingResult,
  SecretProvider,
  SecretValue,
  AuditRecorder,
  ExecutorMatch,
  ValidationResult,
  ExecutorType,
};
export type {
  ApiPreparationSpec,
  EnvironmentProfile,
  ResourceMapping,
  DataConstraint,
  DataValueExpression,
  TestProvenance,
  PreparationAction,
};

// ---- HTTP primitives ------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export const HTTP_METHODS: ReadonlyArray<HttpMethod> = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
];

export const DANGEROUS_METHODS: ReadonlyArray<string> = ['CONNECT', 'TRACE'];

export const UNSAFE_PROTOCOLS: ReadonlyArray<string> = [
  'file:',
  'ftp:',
  'gopher:',
  'data:',
  'javascript:',
];

export const SAFE_PROTOCOLS: ReadonlyArray<string> = ['https:', 'http:'];

// ---- Header types -------------------------------------------------------

export type ApiHeaderValue =
  | string
  | { literal: string }
  | { bindingRef: string }
  | { secretRef: string };

export const SENSITIVE_HEADERS: ReadonlyArray<string> = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'proxy-authorization',
];

export const FORBIDDEN_HEADER_OVERRIDES: ReadonlyArray<string> = [
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
];

// ---- Request spec -------------------------------------------------------

export interface ApiResponseMapping {
  source: string; // dot-path: "body.id", "header.Location"
  target: string; // binding name: "runtime.userId"
  sensitive?: boolean;
}

export interface ApiRequestSpec {
  resourceId: string;
  method: HttpMethod;
  path: string;
  pathParams?: Record<string, DataValueExpression>;
  query?: Record<string, DataValueExpression>;
  headers?: Record<string, ApiHeaderValue>;
  body?: unknown;
  expectedStatus?: number[];
  responseMappings: ApiResponseMapping[];
  timeoutMs?: number;
}

// ---- Compiled HTTP request ------------------------------------------------

export interface CompiledHttpRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  metadata: {
    resourceId: string;
    operationId: string;
    path: string;
    responseMappings: ApiResponseMapping[];
    expectedStatus?: number[];
  };
}

// ---- HTTP response --------------------------------------------------------

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string | null;
  durationMs: number;
  contentType?: string;
}

// ---- Transport abstraction ------------------------------------------------

export interface HttpTransport {
  send(request: CompiledHttpRequest): Promise<HttpResponse>;
}

// ---- Auth strategies ------------------------------------------------------

export type AuthStrategyKind = 'none' | 'bearer' | 'api-key' | 'basic' | 'custom-header';

export interface AuthStrategy {
  kind: AuthStrategyKind;
  secretRef?: string;
  headerName?: string;
  usernameRef?: string;
  passwordRef?: string;
}

// ---- Network policy -------------------------------------------------------

export interface NetworkPolicy {
  allowedOrigins: string[];
  allowedHosts: string[];
  allowPrivateNetwork: boolean;
  allowHttp: boolean;
  maxRedirects: number;
  maxResponseBytes: number;
}

export const DEFAULT_NETWORK_POLICY: NetworkPolicy = {
  allowedOrigins: [],
  allowedHosts: [],
  allowPrivateNetwork: false,
  allowHttp: false,
  maxRedirects: 0,
  maxResponseBytes: 10 * 1024 * 1024, // 10 MB
};

// ---- Retry policy ---------------------------------------------------------

export interface RetryPolicy {
  maxRetries: number;
  retryOnStatuses: number[];
  retryIdempotentOnly: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 0,
  retryOnStatuses: [408, 429, 502, 503, 504],
  retryIdempotentOnly: true,
};

// ---- API executor options -------------------------------------------------

export interface ApiExecutorOptions {
  networkPolicy?: Partial<NetworkPolicy>;
  retryPolicy?: Partial<RetryPolicy>;
  defaultTimeoutMs?: number;
  transport?: HttpTransport;
  resourceMappings?: Record<string, ResourceMapping>;
}

// ---- Audit events ---------------------------------------------------------

export type ApiAuditEventType =
  | 'api.validation'
  | 'api.compiled'
  | 'api.request.started'
  | 'api.response.received'
  | 'api.binding.produced'
  | 'api.cleanup.started'
  | 'api.cleanup.completed'
  | 'api.rollback.attempted'
  | 'api.request.failed';

// ---- Compiled operation ---------------------------------------------------

export interface CompiledApiOperation {
  request: CompiledHttpRequest;
  resourceId: string;
  operationId: string;
  authStrategy?: AuthStrategy;
  cleanupSpec?: ApiRequestSpec;
}

// ---- Re-exports for external use ------------------------------------------

// ExecutorType is already exported above
