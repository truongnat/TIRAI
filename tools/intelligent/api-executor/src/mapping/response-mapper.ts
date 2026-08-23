// API Executor v1 — Response mapper.
//
// Maps HTTP responses into runtime bindings.

import type {
  HttpResponse,
  ApiResponseMapping,
  RuntimeBindingStore,
} from '../models.js';
import { ApiErrorCode, ApiExecutorError } from '../errors.js';

export interface MappingResult {
  producedBindings: Array<{ name: string; value: unknown; sensitive: boolean }>;
}

export function mapResponseToBindings(
  response: HttpResponse,
  mappings: ApiResponseMapping[],
  bindings: RuntimeBindingStore,
  operationId: string,
): MappingResult {
  const producedBindings: Array<{ name: string; value: unknown; sensitive: boolean }> = [];

  let parsedBody: unknown = null;
  if (response.body) {
    const contentType = response.contentType ?? '';
    if (contentType.includes('application/json')) {
      try {
        parsedBody = JSON.parse(response.body);
      } catch {
        throw new ApiExecutorError(
          ApiErrorCode.API_RESPONSE_PARSE,
          'Response body is not valid JSON.',
          { operationId, statusCode: response.status },
        );
      }
    } else {
      parsedBody = response.body;
    }
  }

  for (const mapping of mappings) {
    const value = extractValueFromResponse(response, parsedBody, mapping.source);

    if (value === undefined) {
      throw new ApiExecutorError(
        ApiErrorCode.API_RESPONSE_MAPPING,
        `Response mapping source '${mapping.source}' not found in response.`,
        { operationId },
      );
    }

    bindings.produce({
      id: mapping.target,
      name: mapping.target,
      producerOperationId: operationId,
      value,
      sensitive: mapping.sensitive ?? false,
      status: 'resolved',
    });

    producedBindings.push({
      name: mapping.target,
      value,
      sensitive: mapping.sensitive ?? false,
    });
  }

  return { producedBindings };
}

function extractValueFromResponse(
  response: HttpResponse,
  parsedBody: unknown,
  source: string,
): unknown {
  if (source.startsWith('body.')) {
    const path = source.slice(5);
    return getNestedValue(parsedBody, path);
  }

  if (source.startsWith('header.')) {
    const headerName = source.slice(7).toLowerCase();
    return response.headers[headerName];
  }

  if (source === 'status') {
    return response.status;
  }

  return undefined;
}

function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined;

  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

export function validateResponseStatus(
  response: HttpResponse,
  expectedStatus: number[] | undefined,
  operationId: string,
): void {
  if (expectedStatus && expectedStatus.length > 0) {
    if (!expectedStatus.includes(response.status)) {
      throw new ApiExecutorError(
        ApiErrorCode.API_RESPONSE_STATUS,
        `Expected status ${expectedStatus.join(' or ')}, got ${response.status}`,
        { operationId, statusCode: response.status },
      );
    }
  } else {
    // Default: 2xx is success
    if (response.status < 200 || response.status >= 300) {
      throw new ApiExecutorError(
        ApiErrorCode.API_RESPONSE_STATUS,
        `Unexpected status ${response.status} (expected 2xx)`,
        { operationId, statusCode: response.status },
      );
    }
  }
}
