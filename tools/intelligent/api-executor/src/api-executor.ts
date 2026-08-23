// API Executor v1 — Main executor.
//
// Implements PreparationExecutor contract for safe HTTP preparation operations.

import {
  DEFAULT_NETWORK_POLICY,
  DEFAULT_RETRY_POLICY,
  type PreparationExecutor,
  type PreparationOperation,
  type ExecutionContext,
  type OperationExecutionResult,
  type ExecutorMatch,
  type ValidationResult,
  type RuntimeBindingResult,
  type SecretProvider,
  type SecretValue,
  type ApiPreparationSpec,
  type ResourceMapping,
  type ApiExecutorOptions,
  type ApiRequestSpec,
  type HttpTransport,
  type NetworkPolicy,
  type RetryPolicy,
  type AuthStrategy,
  type CompiledHttpRequest,
  type HttpResponse,
} from './models.js';
import { ApiErrorCode, ApiExecutorError } from './errors.js';
import { compileApiRequest, isMutatingMethod, isIdempotentMethod } from './compiler/index.js';
import { resolveAuthHeaders } from './auth/index.js';
import { mapResponseToBindings, validateResponseStatus } from './mapping/index.js';
import { validateApiOperation, validateMutationGate } from './validation/index.js';

export class APIExecutor implements PreparationExecutor {
  readonly type = 'api' as const;
  private options: ApiExecutorOptions;
  private networkPolicy: NetworkPolicy;
  private retryPolicy: RetryPolicy;
  private transport: HttpTransport | undefined;
  private resourceMappings: Record<string, ResourceMapping>;

  constructor(options: ApiExecutorOptions = {}) {
    this.options = options;
    this.networkPolicy = { ...DEFAULT_NETWORK_POLICY, ...options.networkPolicy };
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retryPolicy };
    this.transport = options.transport;
    this.resourceMappings = options.resourceMappings ?? {};
  }

  canExecute(
    operation: PreparationOperation,
    _context: ExecutionContext,
  ): ExecutorMatch {
    if (operation.resolver !== 'api') {
      return { supported: false, score: 0, reasons: ['Not an API resolver operation'] };
    }
    if (!operation.resolverSpec) {
      return { supported: false, score: 0, reasons: ['No resolverSpec provided'] };
    }

    return {
      supported: true,
      score: 0.9,
      reasons: ['API preparation operation detected'],
    };
  }

  async validate(
    operation: PreparationOperation,
    context: ExecutionContext,
  ): Promise<ValidationResult> {
    try {
      const spec = this.extractApiSpec(operation);
      const resourceMapping = this.getResourceMapping(spec, context);
      const requestSpec = this.buildRequestSpec(spec);

      validateApiOperation(
        requestSpec,
        resourceMapping,
        context.policy,
        this.networkPolicy,
        spec.operationId,
      );

      return { valid: true, errors: [] };
    } catch (err) {
      return {
        valid: false,
        errors: [{
          code: err instanceof ApiExecutorError ? err.code : ApiErrorCode.API_UNKNOWN_ERROR,
          message: err instanceof Error ? err.message : String(err),
        }],
      };
    }
  }

  async execute(
    operation: PreparationOperation,
    context: ExecutionContext,
  ): Promise<OperationExecutionResult> {
    const startTime = Date.now();
    const spec = this.extractApiSpec(operation);
    const operationId = spec.operationId;

    try {
      const resourceMapping = this.getResourceMapping(spec, context);
      const requestSpec = this.buildRequestSpec(spec);

      // Validate operation
      validateApiOperation(
        requestSpec,
        resourceMapping,
        context.policy,
        this.networkPolicy,
        operationId,
      );

      // Compile request
      const compiled = compileApiRequest({
        spec: requestSpec,
        resourceMapping,
        bindings: context.bindings,
        policy: this.networkPolicy,
        operationId,
        defaultTimeoutMs: this.options.defaultTimeoutMs,
      });

      this.recordAudit(context, 'api.compiled', { operationId, method: compiled.method, url: compiled.url });

      // Dry-run: compile only, no transport
      if (context.mode === 'dry-run') {
        return this.buildDryRunResult(operation, compiled, startTime);
      }

      // Simulate: use fake transport only
      if (context.mode === 'simulate') {
        return await this.executeSimulate(operation, compiled, context, startTime);
      }

      // Execute: real transport with all safety gates
      if (context.mode === 'execute') {
        // Validate mutation gates for mutating methods
        if (isMutatingMethod(requestSpec.method)) {
          validateMutationGate(requestSpec, context.policy, operationId);
        }

        return await this.executeReal(operation, compiled, context, startTime);
      }

      throw new ApiExecutorError(
        ApiErrorCode.API_INVALID_OPERATION,
        `Unknown execution mode: ${context.mode}`,
        { operationId },
      );
    } catch (err) {
      return this.buildErrorResult(operation, err, operationId, startTime);
    }
  }

  async cleanup(
    operation: PreparationOperation,
    context: ExecutionContext,
  ): Promise<OperationExecutionResult> {
    const startTime = Date.now();
    const spec = this.extractApiSpec(operation);
    const operationId = spec.operationId;

    try {
      if (!spec.cleanupIntent) {
        // No cleanup defined — return success
        return this.buildSuccessResult(operation, [], startTime);
      }

      // Build cleanup request from cleanupIntent
      const cleanupSpec = this.buildCleanupSpec(spec);
      if (!cleanupSpec) {
        throw new ApiExecutorError(
          ApiErrorCode.API_CLEANUP_FAILED,
          'Cannot build cleanup specification.',
          { operationId },
        );
      }

      const resourceMapping = this.getResourceMapping(spec, context);

      const compiled = compileApiRequest({
        spec: cleanupSpec,
        resourceMapping,
        bindings: context.bindings,
        policy: this.networkPolicy,
        operationId: `${operationId}-cleanup`,
        defaultTimeoutMs: this.options.defaultTimeoutMs,
      });

      this.recordAudit(context, 'api.cleanup.started', { operationId });

      if (context.mode === 'dry-run') {
        return this.buildDryRunResult(operation, compiled, startTime);
      }

      if (context.mode === 'simulate') {
        return await this.executeSimulate(operation, compiled, context, startTime);
      }

      if (context.mode === 'execute') {
        return await this.executeReal(operation, compiled, context, startTime);
      }

      throw new ApiExecutorError(
        ApiErrorCode.API_INVALID_OPERATION,
        `Unknown execution mode: ${context.mode}`,
        { operationId },
      );
    } catch (err) {
      return this.buildErrorResult(operation, err, operationId, startTime);
    }
  }

  async rollback(
    operation: PreparationOperation,
    context: ExecutionContext,
  ): Promise<OperationExecutionResult> {
    // HTTP has no generic rollback. Rollback requires explicit compensation
    // defined in the operation's cleanupIntent. Do NOT silently delegate to
    // cleanup — cleanup and rollback are semantically distinct.
    const startTime = Date.now();
    const spec = this.extractApiSpec(operation);

    if (!spec.cleanupIntent) {
      // No explicit compensation defined — rollback is unavailable.
      return {
        operationId: spec.operationId,
        dataItemId: operation.dataItemId,
        status: 'failed',
        executorType: 'api',
        action: operation.action,
        startedAt: new Date(startTime).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        producedBindings: [],
        warnings: [{ code: ApiErrorCode.API_ROLLBACK_UNAVAILABLE, message: 'Rollback unavailable: no explicit compensation defined for this operation.' }],
        error: {
          code: ApiErrorCode.API_ROLLBACK_UNAVAILABLE,
          message: `No explicit compensation defined for rollback of operation '${spec.operationId}'.`,
          retryable: false,
          executorType: 'api',
        },
        provenance: operation.provenance,
        retryCount: 0,
      };
    }

    // Explicit compensation exists — execute it as rollback.
    return this.cleanup(operation, context);
  }

  // ---- Private helpers ----------------------------------------------------

  private extractApiSpec(operation: PreparationOperation): ApiPreparationSpec {
    if (!operation.resolverSpec) {
      throw new ApiExecutorError(
        ApiErrorCode.API_INVALID_OPERATION,
        'Operation has no resolverSpec.',
      );
    }
    return operation.resolverSpec as unknown as ApiPreparationSpec;
  }

  private getResourceMapping(spec: ApiPreparationSpec, _context: ExecutionContext): ResourceMapping {
    // Base URLs come exclusively from explicit environment resource configuration.
    // Missing mapping must fail closed — no localhost or default origin fallback.
    const configured = this.resourceMappings[spec.resource];
    if (!configured) {
      throw new ApiExecutorError(
        ApiErrorCode.API_RESOURCE_MAPPING_MISSING,
        `No resource mapping configured for '${spec.resource}'. ` +
        'Resource mappings must be explicitly provided via environment profile.',
        { operationId: spec.operationId },
      );
    }

    // Even when a mapping exists, baseUrl must be explicitly configured.
    const baseUrl = configured.fieldMappings?.['baseUrl'] ?? configured.fieldMappings?.['__baseUrl'];
    if (!baseUrl) {
      throw new ApiExecutorError(
        ApiErrorCode.API_BASE_URL_MISSING,
        `Resource '${spec.resource}' has no baseUrl configured. ` +
        'A baseUrl is required for API request compilation.',
        { operationId: spec.operationId },
      );
    }

    return configured;
  }

  private buildRequestSpec(spec: ApiPreparationSpec): ApiRequestSpec {
    // Convert ApiPreparationSpec to ApiRequestSpec
    // This is a simplified mapping — real implementation would need richer IR
    const method = this.mapMethodIntent(spec.methodIntent);

    return {
      resourceId: spec.resource,
      method,
      path: `/${spec.operationId}`, // Simplified — real IR would provide path
      responseMappings: spec.responseBindings.map((name) => ({
        source: `body.${name}`,
        target: name,
      })),
    };
  }

  private mapMethodIntent(intent: string): ApiRequestSpec['method'] {
    const upper = intent.toUpperCase();
    if (upper.includes('GET') || upper.includes('READ') || upper.includes('FETCH')) return 'GET';
    if (upper.includes('POST') || upper.includes('CREATE')) return 'POST';
    if (upper.includes('PUT') || upper.includes('UPDATE')) return 'PUT';
    if (upper.includes('PATCH')) return 'PATCH';
    if (upper.includes('DELETE') || upper.includes('REMOVE')) return 'DELETE';
    return 'GET'; // Default to safe method
  }

  private buildCleanupSpec(spec: ApiPreparationSpec): ApiRequestSpec | undefined {
    if (!spec.cleanupIntent) return undefined;

    return {
      resourceId: spec.resource,
      method: 'DELETE',
      path: `/${spec.operationId}`, // Simplified
      responseMappings: [],
    };
  }

  private async executeSimulate(
    operation: PreparationOperation,
    compiled: CompiledHttpRequest,
    context: ExecutionContext,
    startTime: number,
  ): Promise<OperationExecutionResult> {
    // Simulate mode uses fake transport only
    const transport = this.transport;
    if (!transport) {
      throw new ApiExecutorError(
        ApiErrorCode.API_INVALID_OPERATION,
        'Simulate mode requires a transport to be configured.',
        { operationId: compiled.metadata.operationId },
      );
    }

    return await this.sendRequest(operation, compiled, context, transport, startTime);
  }

  private async executeReal(
    operation: PreparationOperation,
    compiled: CompiledHttpRequest,
    context: ExecutionContext,
    startTime: number,
  ): Promise<OperationExecutionResult> {
    // Real execution requires transport
    const transport = this.transport;
    if (!transport) {
      throw new ApiExecutorError(
        ApiErrorCode.API_INVALID_OPERATION,
        'Execute mode requires a transport to be configured.',
        { operationId: compiled.metadata.operationId },
      );
    }

    return await this.sendRequest(operation, compiled, context, transport, startTime);
  }

  private async sendRequest(
    operation: PreparationOperation,
    compiled: CompiledHttpRequest,
    context: ExecutionContext,
    transport: HttpTransport,
    startTime: number,
  ): Promise<OperationExecutionResult> {
    const operationId = compiled.metadata.operationId;

    // Resolve auth headers
    const auth = this.extractAuthStrategy(compiled);
    const authHeaders = await resolveAuthHeaders(auth, this.createFakeSecretProvider(), operationId);

    // Merge auth headers into request
    const requestWithAuth: CompiledHttpRequest = {
      ...compiled,
      headers: { ...compiled.headers, ...authHeaders },
    };

    this.recordAudit(context, 'api.request.started', {
      operationId,
      method: requestWithAuth.method,
      url: requestWithAuth.url,
    });

    // Send request with retry logic
    const response = await this.sendWithRetry(requestWithAuth, transport, operationId);

    this.recordAudit(context, 'api.response.received', {
      operationId,
      status: response.status,
    });

    // Validate status
    validateResponseStatus(response, compiled.metadata.expectedStatus, operationId);

    // Map response to bindings
    const mappingResult = mapResponseToBindings(
      response,
      compiled.metadata.responseMappings,
      context.bindings,
      operationId,
    );

    for (const binding of mappingResult.producedBindings) {
      this.recordAudit(context, 'api.binding.produced', {
        operationId,
        bindingName: binding.name,
        sensitive: binding.sensitive,
      });
    }

    const producedBindings: RuntimeBindingResult[] = mappingResult.producedBindings.map((b) => ({
      id: b.name,
      name: b.name,
      producerOperationId: operationId,
      value: b.value,
      sensitive: b.sensitive,
      status: 'resolved' as const,
    }));

    return {
      operationId,
      dataItemId: operation.dataItemId,
      status: 'succeeded',
      executorType: 'api',
      action: operation.action,
      startedAt: new Date(startTime).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      producedBindings,
      warnings: [],
      provenance: operation.provenance,
      retryCount: 0,
    };
  }

  private async sendWithRetry(
    request: CompiledHttpRequest,
    transport: HttpTransport,
    operationId: string,
  ): Promise<HttpResponse> {
    const maxAttempts = this.retryPolicy.maxRetries + 1;
    const canRetry = !this.retryPolicy.retryIdempotentOnly || isIdempotentMethod(request.method);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await transport.send(request);

        // Check if we should retry based on status
        if (
          attempt < maxAttempts - 1 &&
          canRetry &&
          this.retryPolicy.retryOnStatuses.includes(response.status)
        ) {
          continue;
        }

        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Only retry on retryable errors
        if (err instanceof ApiExecutorError && !err.retryable) {
          throw err;
        }

        if (attempt < maxAttempts - 1 && canRetry) {
          continue;
        }

        throw err;
      }
    }

    throw lastError ?? new ApiExecutorError(
      ApiErrorCode.API_NETWORK_ERROR,
      'Request failed after all retry attempts.',
      { operationId },
    );
  }

  private extractAuthStrategy(_request: CompiledHttpRequest): AuthStrategy | undefined {
    // Auth strategy would come from operation metadata or resource config
    // For now, return undefined (no auth)
    return undefined;
  }

  private createFakeSecretProvider(): SecretProvider {
    return {
      async resolve(_secretRef: string): Promise<SecretValue> {
        return { value: 'fake-secret', redacted: '***REDACTED***' };
      },
    };
  }

  private buildDryRunResult(
    operation: PreparationOperation,
    compiled: CompiledHttpRequest,
    startTime: number,
  ): OperationExecutionResult {
    return {
      operationId: compiled.metadata.operationId,
      dataItemId: operation.dataItemId,
      status: 'validated',
      executorType: 'api',
      action: operation.action,
      startedAt: new Date(startTime).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      producedBindings: [],
      warnings: [],
      provenance: operation.provenance,
      retryCount: 0,
    };
  }

  private buildSuccessResult(
    operation: PreparationOperation,
    producedBindings: RuntimeBindingResult[],
    startTime: number,
  ): OperationExecutionResult {
    return {
      operationId: operation.id,
      dataItemId: operation.dataItemId,
      status: 'succeeded',
      executorType: 'api',
      action: operation.action,
      startedAt: new Date(startTime).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      producedBindings,
      warnings: [],
      provenance: operation.provenance,
      retryCount: 0,
    };
  }

  private buildErrorResult(
    operation: PreparationOperation,
    err: unknown,
    operationId: string,
    startTime: number,
  ): OperationExecutionResult {
    const code = err instanceof ApiExecutorError ? err.code : ApiErrorCode.API_UNKNOWN_ERROR;
    const message = err instanceof Error ? err.message : String(err);

    return {
      operationId,
      dataItemId: operation.dataItemId,
      status: 'failed',
      executorType: 'api',
      action: operation.action,
      startedAt: new Date(startTime).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      producedBindings: [],
      warnings: [],
      error: {
        code,
        message,
        retryable: err instanceof ApiExecutorError ? err.retryable : false,
        executorType: 'api',
      },
      provenance: operation.provenance,
      retryCount: 0,
    };
  }

  private recordAudit(
    context: ExecutionContext,
    type: string,
    data: Record<string, unknown>,
  ): void {
    context.audit.record({
      type: 'operation-start',
      operationId: data.operationId as string,
      message: `${type}: ${JSON.stringify(data)}`,
    });
  }
}
