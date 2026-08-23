// API Executor v1 — Request compiler.
//
// Compiles ApiRequestSpec into CompiledHttpRequest without performing network IO.

import {
  HTTP_METHODS,
  FORBIDDEN_HEADER_OVERRIDES,
  type ApiRequestSpec,
  type CompiledHttpRequest,
  type DataValueExpression,
  type RuntimeBindingStore,
  type NetworkPolicy,
  type ResourceMapping,
  type ApiHeaderValue,
  type HttpMethod,
} from '../models.js';
import { ApiErrorCode, ApiExecutorError } from '../errors.js';
import { buildSafeUrl } from './url-safety.js';
import { resolveValueExpression, resolveRecordExpressions, resolveBodyDeep } from './binding-resolver.js';
export interface CompileOptions {
  spec: ApiRequestSpec;
  resourceMapping: ResourceMapping;
  bindings: RuntimeBindingStore;
  policy: NetworkPolicy;
  operationId: string;
  defaultTimeoutMs?: number;
}

export function compileApiRequest(options: CompileOptions): CompiledHttpRequest {
  const { spec, resourceMapping, bindings, policy, operationId, defaultTimeoutMs } = options;

  // Validate method
  if (!HTTP_METHODS.includes(spec.method)) {
    throw new ApiExecutorError(
      ApiErrorCode.API_METHOD_UNSUPPORTED,
      `HTTP method ${spec.method} is not supported. Allowed: ${HTTP_METHODS.join(', ')}`,
      { operationId },
    );
  }

  // Resolve base URL from resource mapping metadata
  const baseUrl = resourceMapping.fieldMappings?.['baseUrl'] ?? resourceMapping.fieldMappings?.['__baseUrl'];
  if (!baseUrl) {
    throw new ApiExecutorError(
      ApiErrorCode.API_RESOURCE_DENIED,
      `Resource '${spec.resourceId}' has no base URL configured.`,
      { operationId },
    );
  }

  // Resolve path parameters
  const resolvedPath = resolvePath(spec.path, spec.pathParams, bindings, operationId);

  // Build safe URL
  const url = buildSafeUrl(baseUrl, resolvedPath, policy);

  // Resolve query parameters
  const resolvedQuery = resolveRecordExpressions(spec.query, bindings, operationId);
  if (Object.keys(resolvedQuery).length > 0) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(resolvedQuery)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    url.search = searchParams.toString();
  }

  // Resolve headers
  const resolvedHeaders = resolveHeaders(spec.headers, bindings, operationId);

  // Resolve body
  let resolvedBody: string | undefined;
  if (spec.body !== undefined && spec.body !== null) {
    const resolvedBodyObj = resolveBodyDeep(spec.body, bindings, operationId);
    resolvedBody = JSON.stringify(resolvedBodyObj);
    if (!resolvedHeaders['content-type']) {
      resolvedHeaders['content-type'] = 'application/json';
    }
  }

  const timeoutMs = spec.timeoutMs ?? defaultTimeoutMs ?? 30000;

  return {
    method: spec.method,
    url: url.toString(),
    headers: resolvedHeaders,
    body: resolvedBody,
    timeoutMs,
    metadata: {
      resourceId: spec.resourceId,
      operationId,
      path: spec.path,
      responseMappings: spec.responseMappings,
      expectedStatus: spec.expectedStatus,
    },
  };
}

function resolvePath(
  path: string,
  pathParams: Record<string, DataValueExpression> | undefined,
  bindings: RuntimeBindingStore,
  operationId: string,
): string {
  if (!pathParams) return path;

  let resolvedPath = path;
  for (const [key, expr] of Object.entries(pathParams)) {
    const value = resolveValueExpression(expr, bindings, operationId);
    const encoded = encodeURIComponent(String(value));
    resolvedPath = resolvedPath.replace(`{${key}}`, encoded);
  }

  return resolvedPath;
}

function resolveHeaders(
  headers: Record<string, ApiHeaderValue> | undefined,
  bindings: RuntimeBindingStore,
  operationId: string,
): Record<string, string> {
  if (!headers) return {};

  const resolved: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    // Reject forbidden header overrides
    if (FORBIDDEN_HEADER_OVERRIDES.includes(lowerKey)) {
      throw new ApiExecutorError(
        ApiErrorCode.API_HEADER_FORBIDDEN,
        `Header '${key}' is managed by the transport layer and cannot be overridden.`,
        { operationId },
      );
    }

    let resolvedValue: string;

    if (typeof value === 'string') {
      resolvedValue = value;
    } else if ('literal' in value) {
      resolvedValue = value.literal;
    } else if ('bindingRef' in value) {
      const binding = bindings.resolve(value.bindingRef);
      if (!binding) {
        throw new ApiExecutorError(
          ApiErrorCode.API_BINDING_MISSING,
          `Header '${key}' references missing binding '${value.bindingRef}'.`,
          { operationId },
        );
      }
      resolvedValue = String(binding.value);
    } else if ('secretRef' in value) {
      // Secret headers are resolved at transport time, not compile time.
      // Mark with placeholder for now.
      resolvedValue = `***SECRET_REF:${value.secretRef}***`;
    } else {
      throw new ApiExecutorError(
        ApiErrorCode.API_INVALID_OPERATION,
        `Invalid header value type for '${key}'.`,
        { operationId },
      );
    }

    resolved[lowerKey] = resolvedValue;
  }

  return resolved;
}

export function isMutatingMethod(method: HttpMethod): boolean {
  return method !== 'GET';
}

export function isIdempotentMethod(method: HttpMethod): boolean {
  return method === 'GET' || method === 'PUT' || method === 'DELETE';
}
