// API Executor v1 — HTTP transports.
//
// FakeHttpTransport for testing, FetchHttpTransport for real execution.

import type { HttpTransport, CompiledHttpRequest, HttpResponse } from '../models.js';
import { ApiErrorCode, ApiExecutorError } from '../errors.js';

// ---- Fake transport for testing -------------------------------------------

export interface FakeTransportResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string | object;
  delayMs?: number;
}

export interface FakeTransportOptions {
  responses?: FakeTransportResponse[];
  defaultResponse?: FakeTransportResponse;
  networkError?: boolean;
  timeout?: boolean;
}

export class FakeHttpTransport implements HttpTransport {
  private responses: FakeTransportResponse[];
  private defaultResponse: FakeTransportResponse;
  private networkError: boolean;
  private timeout: boolean;
  private capturedRequests: CompiledHttpRequest[] = [];
  private requestCount = 0;

  constructor(options: FakeTransportOptions = {}) {
    this.responses = options.responses ?? [];
    this.defaultResponse = options.defaultResponse ?? { status: 200, body: '{}' };
    this.networkError = options.networkError ?? false;
    this.timeout = options.timeout ?? false;
  }

  async send(request: CompiledHttpRequest): Promise<HttpResponse> {
    this.capturedRequests.push(request);
    this.requestCount++;

    if (this.networkError) {
      throw new ApiExecutorError(
        ApiErrorCode.API_NETWORK_ERROR,
        'Simulated network error',
        { operationId: request.metadata.operationId },
      );
    }

    if (this.timeout) {
      throw new ApiExecutorError(
        ApiErrorCode.API_TIMEOUT,
        'Simulated timeout',
        { operationId: request.metadata.operationId },
      );
    }

    const response = this.responses.shift() ?? this.defaultResponse;

    if (response.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, response.delayMs));
    }

    const body = typeof response.body === 'object'
      ? JSON.stringify(response.body)
      : response.body ?? null;

    return {
      status: response.status,
      headers: response.headers ?? {},
      body,
      durationMs: response.delayMs ?? 0,
      contentType: response.headers?.['content-type'] ?? 'application/json',
    };
  }

  getCapturedRequests(): CompiledHttpRequest[] {
    return this.capturedRequests;
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  reset(): void {
    this.capturedRequests = [];
    this.requestCount = 0;
  }
}

// ---- Fetch transport for real execution -----------------------------------

export class FetchHttpTransport implements HttpTransport {
  async send(request: CompiledHttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
        redirect: 'manual', // Do not follow redirects automatically
      });

      const contentType = response.headers.get('content-type') ?? undefined;
      const body = await response.text();

      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
        durationMs: 0, // Will be calculated by caller
        contentType,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ApiExecutorError(
          ApiErrorCode.API_TIMEOUT,
          `Request timed out after ${request.timeoutMs}ms`,
          { operationId: request.metadata.operationId, retryable: true },
        );
      }
      throw new ApiExecutorError(
        ApiErrorCode.API_NETWORK_ERROR,
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        { operationId: request.metadata.operationId, retryable: true },
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
