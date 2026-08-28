import {
  DeliveryCoordinatorConfig,
  CoordinateDeliveryRequest,
  CoordinateDeliveryResponse,
  OutputDeliveryResult,
  AggregateDeliveryStatus,
  CoordinatorMetrics,
  CanonicalOutputPayload,
  OutputDeliveryContext,
  DeliveryKeyId,
  PayloadFingerprint,
  DeliveryStatus,
  OutputTarget,
  DeliveryPolicy,
} from './models.js';
import { projectToCanonicalPayload, Scenario3Result } from './projection.js';
import { computeDeliveryKey, computePayloadFingerprint, computeOutputId } from './fingerprint.js';
import { sanitizePayload } from './sanitization.js';

export class DeliveryCoordinator {
  private config: DeliveryCoordinatorConfig;
  private metrics: CoordinatorMetrics;

  constructor(config: DeliveryCoordinatorConfig) {
    this.config = config;
    this.metrics = this.createInitialMetrics();
  }

  async deliver(request: CoordinateDeliveryRequest): Promise<CoordinateDeliveryResponse> {
    const results: OutputDeliveryResult[] = [];
    const scenario3Result = request.result as Scenario3Result;
    const runId = this.extractRunId(scenario3Result);

    const payload = projectToCanonicalPayload(scenario3Result, runId);

    const { sanitized: sanitizedPayload, secretLeakCount } = sanitizePayload(payload);
    this.metrics.payloadsSanitized++;
    this.metrics.secretLeakCount += secretLeakCount;

    const finalPayload = sanitizedPayload as CanonicalOutputPayload;

    this.metrics.providersConfigured = request.targets.length;

    for (const target of request.targets) {
      const result = await this.deliverToProvider(
        finalPayload,
        target,
        runId,
        request.dryRun ?? false,
      );
      results.push(result);
    }

    const aggregateStatus = this.computeAggregateStatus(results);

    return {
      results,
      aggregateStatus,
      metrics: { ...this.metrics },
    };
  }

  private async deliverToProvider(
    payload: CanonicalOutputPayload,
    target: { providerId: string; target: OutputTarget; policy?: DeliveryPolicy },
    runId: string,
    dryRun: boolean,
  ): Promise<OutputDeliveryResult> {
    let provider;
    try {
      provider = this.config.registry.resolve(target.providerId);
      this.metrics.providersResolved++;
    } catch {
      this.metrics.providersFailed++;
      return {
        success: false,
        status: 'FAILED',
        outputId: '',
        deliveryKey: '',
        payloadFingerprint: '',
        providerId: target.providerId,
        error: `Provider not found: ${target.providerId}`,
      };
    }

    const targetIdentity = this.computeTargetIdentity(target.target);
    const deliveryKey = computeDeliveryKey({
      providerId: target.providerId,
      targetIdentity,
      runId,
    });

    const payloadFingerprint = computePayloadFingerprint(payload);
    this.metrics.payloadFingerprintsComputed++;

    this.metrics.journalReads++;
    const existingEntry = await this.config.journal.getByDeliveryKey(deliveryKey);

    if (existingEntry && existingEntry.payloadFingerprint === payloadFingerprint) {
      this.metrics.idempotentReplays++;
      this.metrics.deliveryWritesAvoided++;

      return {
        success: true,
        status: 'UNCHANGED',
        outputId: existingEntry.id,
        deliveryKey,
        payloadFingerprint,
        providerId: target.providerId,
        target: target.target,
      };
    }

    this.metrics.deliveryAttempts++;

    const context: OutputDeliveryContext = {
      providerId: target.providerId,
      target: target.target,
      deliveryPolicy: target.policy ?? 'OVERWRITE_CURRENT',
      dryRun,
    };

    let result: OutputDeliveryResult;
    try {
      this.metrics.deliveryWrites++;
      result = await provider.deliver(payload, context);

      result.payloadFingerprint = payloadFingerprint;

      if (existingEntry) {
        this.metrics.reportsUpdated++;
        await this.config.journal.update(existingEntry.id, {
          payloadFingerprint,
          status: result.status,
          sourceRevision: payload.sourceRevision.revision,
          resultRevision: payload.sourceRevision.revisionFingerprint,
        });
        this.metrics.journalWrites++;
      } else {
        this.metrics.reportsCreated++;
        await this.config.journal.record({
          deliveryKey,
          providerId: target.providerId,
          target: target.target,
          payloadFingerprint,
          status: result.status,
          sourceRevision: payload.sourceRevision.revision,
          resultRevision: payload.sourceRevision.revisionFingerprint,
        });
        this.metrics.journalWrites++;
      }

      if (result.status === 'DELIVERED') {
        this.metrics.providersDelivered++;
      } else if (result.status === 'SKIPPED') {
        this.metrics.providersSkipped++;
      } else {
        this.metrics.providersFailed++;
      }
    } catch (error) {
      this.metrics.providersFailed++;
      result = {
        success: false,
        status: 'FAILED',
        outputId: computeOutputId(runId, deliveryKey),
        deliveryKey,
        payloadFingerprint,
        providerId: target.providerId,
        target: target.target,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return result;
  }

  private computeTargetIdentity(target: OutputTarget): string {
    if (target.path) return target.path;
    return JSON.stringify(target);
  }

  private extractRunId(result: Scenario3Result): string {
    return (result as Record<string, unknown>)['runId'] as string ?? 'unknown-run';
  }

  private computeAggregateStatus(results: OutputDeliveryResult[]): AggregateDeliveryStatus {
    if (results.length === 0) return 'NO_PROVIDERS';

    const delivered = results.filter((r) => r.status === 'DELIVERED').length;
    const skipped = results.filter((r) => r.status === 'SKIPPED').length;
    const failed = results.filter((r) => r.status === 'FAILED').length;
    const blocked = results.filter((r) => r.status === 'BLOCKED').length;

    if (delivered + skipped === results.length) return 'ALL_DELIVERED';
    if (failed === results.length) return 'ALL_FAILED';
    if (skipped === results.length) return 'ALL_SKIPPED';
    if (blocked === results.length) return 'BLOCKED';
    return 'PARTIAL';
  }

  private createInitialMetrics(): CoordinatorMetrics {
    return {
      providersConfigured: 0,
      providersResolved: 0,
      providersDelivered: 0,
      providersFailed: 0,
      providersSkipped: 0,
      deliveryAttempts: 0,
      deliveryWrites: 0,
      deliveryWritesAvoided: 0,
      idempotentReplays: 0,
      payloadFingerprintsComputed: 0,
      journalReads: 0,
      journalWrites: 0,
      reportsCreated: 0,
      reportsUpdated: 0,
      payloadsSanitized: 0,
      secretLeakCount: 0,
    };
  }

  getMetrics(): CoordinatorMetrics {
    return { ...this.metrics };
  }
}
