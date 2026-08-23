// API Executor v1 — Auth resolver.
//
// Resolves authentication strategies using SecretProvider.

import type { AuthStrategy, SecretProvider } from '../models.js';
import { ApiErrorCode, ApiExecutorError } from '../errors.js';

export async function resolveAuthHeaders(
  auth: AuthStrategy | undefined,
  secretProvider: SecretProvider,
  operationId: string,
): Promise<Record<string, string>> {
  if (!auth || auth.kind === 'none') return {};

  const headers: Record<string, string> = {};

  switch (auth.kind) {
    case 'bearer': {
      if (!auth.secretRef) {
        throw new ApiExecutorError(
          ApiErrorCode.API_SECRET_MISSING,
          'Bearer auth requires secretRef.',
          { operationId },
        );
      }
      const secret = await secretProvider.resolve(auth.secretRef);
      if (!secret) {
        throw new ApiExecutorError(
          ApiErrorCode.API_SECRET_MISSING,
          `Secret '${auth.secretRef}' not found for bearer auth.`,
          { operationId },
        );
      }
      headers['authorization'] = `Bearer ${secret.value}`;
      break;
    }

    case 'api-key': {
      if (!auth.headerName || !auth.secretRef) {
        throw new ApiExecutorError(
          ApiErrorCode.API_SECRET_MISSING,
          'API key auth requires headerName and secretRef.',
          { operationId },
        );
      }
      const secret = await secretProvider.resolve(auth.secretRef);
      if (!secret) {
        throw new ApiExecutorError(
          ApiErrorCode.API_SECRET_MISSING,
          `Secret '${auth.secretRef}' not found for API key auth.`,
          { operationId },
        );
      }
      headers[auth.headerName.toLowerCase()] = secret.value;
      break;
    }

    case 'basic': {
      if (!auth.usernameRef || !auth.passwordRef) {
        throw new ApiExecutorError(
          ApiErrorCode.API_SECRET_MISSING,
          'Basic auth requires usernameRef and passwordRef.',
          { operationId },
        );
      }
      const username = await secretProvider.resolve(auth.usernameRef);
      const password = await secretProvider.resolve(auth.passwordRef);
      if (!username || !password) {
        throw new ApiExecutorError(
          ApiErrorCode.API_SECRET_MISSING,
          'Basic auth credentials not found.',
          { operationId },
        );
      }
      const credentials = Buffer.from(`${username.value}:${password.value}`).toString('base64');
      headers['authorization'] = `Basic ${credentials}`;
      break;
    }

    case 'custom-header': {
      if (!auth.headerName || !auth.secretRef) {
        throw new ApiExecutorError(
          ApiErrorCode.API_SECRET_MISSING,
          'Custom header auth requires headerName and secretRef.',
          { operationId },
        );
      }
      const secret = await secretProvider.resolve(auth.secretRef);
      if (!secret) {
        throw new ApiExecutorError(
          ApiErrorCode.API_SECRET_MISSING,
          `Secret '${auth.secretRef}' not found for custom header auth.`,
          { operationId },
        );
      }
      headers[auth.headerName.toLowerCase()] = secret.value;
      break;
    }

    default:
      throw new ApiExecutorError(
        ApiErrorCode.API_INVALID_OPERATION,
        `Unknown auth strategy kind: ${auth.kind}`,
        { operationId },
      );
  }

  return headers;
}

export function redactSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const sensitiveKeys = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization'];
  const redacted: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
      redacted[key] = '***REDACTED***';
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}
