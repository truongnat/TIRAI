// API Executor v1 — Operation validator.
//
// Validates API operations against policy and safety rules.

import type {
  ApiRequestSpec,
  ExecutionPolicy,
  NetworkPolicy,
  ResourceMapping,
} from '../models.js';
import { ApiErrorCode, ApiExecutorError } from '../errors.js';
import { isMutatingMethod } from '../compiler/request-compiler.js';

export function validateApiOperation(
  spec: ApiRequestSpec,
  resourceMapping: ResourceMapping,
  policy: ExecutionPolicy,
  networkPolicy: NetworkPolicy,
  operationId: string,
): void {
  // Validate resource is allowed
  if (!policy.allowedResourceIds.includes(spec.resourceId)) {
    throw new ApiExecutorError(
      ApiErrorCode.API_RESOURCE_DENIED,
      `Resource '${spec.resourceId}' is not in the allowed resource list.`,
      { operationId },
    );
  }

  // Validate executor type is allowed
  if (!policy.allowedExecutorTypes.includes('api')) {
    throw new ApiExecutorError(
      ApiErrorCode.API_RESOURCE_DENIED,
      'API executor is not in the allowed executor types list.',
      { operationId },
    );
  }

  // Validate mutation gates for mutating methods
  if (isMutatingMethod(spec.method)) {
    if (!policy.allowMutation) {
      throw new ApiExecutorError(
        ApiErrorCode.API_MUTATION_DENIED,
        `Mutation operation rejected: policy.allowMutation is false.`,
        { operationId },
      );
    }

    if (policy.deniedResourceIds?.includes(spec.resourceId)) {
      throw new ApiExecutorError(
        ApiErrorCode.API_MUTATION_DENIED,
        `Resource '${spec.resourceId}' is denied for mutation.`,
        { operationId },
      );
    }
  }

  // Validate base URL origin is in allowed origins
  const baseUrl = resourceMapping.fieldMappings?.['baseUrl'] ?? resourceMapping.fieldMappings?.['__baseUrl'];
  if (baseUrl) {
    const origin = new URL(baseUrl).origin;
    if (networkPolicy.allowedOrigins.length > 0 && !networkPolicy.allowedOrigins.includes(origin)) {
      throw new ApiExecutorError(
        ApiErrorCode.API_ORIGIN_MISMATCH,
        `Base URL origin ${origin} is not in allowed origins.`,
        { operationId },
      );
    }
  }
}

export function validateMutationGate(
  spec: ApiRequestSpec,
  policy: ExecutionPolicy,
  operationId: string,
): void {
  if (!isMutatingMethod(spec.method)) return;

  if (!policy.allowMutation) {
    throw new ApiExecutorError(
      ApiErrorCode.API_MUTATION_DENIED,
      'Mutation requires policy.allowMutation=true.',
      { operationId },
    );
  }

  if (policy.deniedResourceIds?.includes(spec.resourceId)) {
    throw new ApiExecutorError(
      ApiErrorCode.API_MUTATION_DENIED,
      `Resource '${spec.resourceId}' is denied for mutation.`,
      { operationId },
    );
  }
}
