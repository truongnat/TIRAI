import {
  MutationCoordinatorConfig,
  MutationRequest,
  MutationResult,
  MutationOperation,
  MutationOutcome,
  MutationMetrics,
  MutationJournalEntry,
  MutationProvider,
  ExternalReference,
  ReconciliationState,
} from './mutation-models.js';
import { PayloadFingerprint, DeliveryKeyId } from './models.js';

export interface MutationCoordinatorConfigExtended extends MutationCoordinatorConfig {
  providers: Map<string, MutationProvider>;
}

export class MutationCoordinator {
  private config: MutationCoordinatorConfigExtended;
  private metrics: MutationMetrics;

  constructor(config: MutationCoordinatorConfigExtended) {
    this.config = config;
    this.metrics = this.createInitialMetrics();
  }

  async mutate(request: MutationRequest): Promise<MutationResult> {
    this.metrics.mutationPlans++;

    if (request.readOnly) {
      this.metrics.readOnlyBlocks++;
      return {
        success: false,
        operation: request.operation,
        outcome: 'CONFIRMED_FAILURE',
        syncKey: request.syncKey,
        providerId: request.providerId,
        error: 'Read-only mode: mutation blocked',
        metrics: { ...this.metrics },
      };
    }

    const provider = this.config.providers.get(request.providerId);
    if (!provider) {
      return {
        success: false,
        operation: request.operation,
        outcome: 'CONFIRMED_FAILURE',
        syncKey: request.syncKey,
        providerId: request.providerId,
        error: `Provider not found: ${request.providerId}`,
        metrics: { ...this.metrics },
      };
    }

    const existingEntry = await this.config.journal.getBySyncKey(request.syncKey);

    const operation = this.determineOperation(request, existingEntry, provider);

    if (operation === 'NOOP') {
      this.metrics.noopDeliveries++;
      return {
        success: true,
        operation: 'NOOP',
        outcome: 'CONFIRMED_SUCCESS',
        syncKey: request.syncKey,
        providerId: request.providerId,
        externalRef: existingEntry?.externalRef,
        remoteVersion: existingEntry?.externalRef?.remoteVersion,
        metrics: { ...this.metrics },
      };
    }

    if (operation === 'UPDATE' && !provider.capabilities.canUpdate) {
      return {
        success: false,
        operation: 'UPDATE',
        outcome: 'CONFIRMED_FAILURE',
        syncKey: request.syncKey,
        providerId: request.providerId,
        error: 'Provider does not support UPDATE',
        metrics: { ...this.metrics },
      };
    }

    const idempotencyKey = request.idempotencyKey ?? this.generateIdempotencyKey(request, operation);

    const journalEntry = await this.config.journal.record({
      syncKey: request.syncKey,
      providerId: request.providerId,
      operation,
      idempotencyKey,
      payloadFingerprint: request.payloadFingerprint,
      outcome: 'DEFINITELY_NOT_SENT',
      reconciliationState: 'NOT_RECONCILED',
      attempt: 1,
      safeRetries: 0,
      unsafeRetries: 0,
    });

    let result: MutationResult;

    if (operation === 'CREATE') {
      this.metrics.createAttempts++;
      result = await this.executeCreate(provider, request, idempotencyKey, journalEntry);
    } else {
      this.metrics.updateAttempts++;
      result = await this.executeUpdate(provider, request, existingEntry, idempotencyKey, journalEntry);
    }

    await this.config.journal.update(journalEntry.id, {
      outcome: result.outcome,
      externalRef: result.externalRef,
      error: result.error,
    });

    return result;
  }

  private determineOperation(
    request: MutationRequest,
    existingEntry: MutationJournalEntry | null,
    provider: MutationProvider,
  ): MutationOperation {
    if (request.operation === 'RECONCILE') {
      return 'RECONCILE';
    }

    if (!existingEntry) {
      return 'CREATE';
    }

    if (
      existingEntry.payloadFingerprint === request.payloadFingerprint &&
      existingEntry.outcome === 'CONFIRMED_SUCCESS'
    ) {
      return 'NOOP';
    }

    if (!existingEntry.externalRef) {
      if (existingEntry.outcome === 'CONFIRMED_SUCCESS' && existingEntry.payloadFingerprint === request.payloadFingerprint) {
        return 'NOOP';
      }
      if (!provider.capabilities.canUpdate) {
        return 'UPDATE';
      }
      return 'CREATE';
    }

    if (!provider.capabilities.canUpdate) {
      return 'UPDATE';
    }

    return 'UPDATE';
  }

  private async executeCreate(
    provider: MutationProvider,
    request: MutationRequest,
    idempotencyKey: string,
    journalEntry: MutationJournalEntry,
  ): Promise<MutationResult> {
    const createResult = await provider.create({
      syncKey: request.syncKey,
      payload: request.payload,
      idempotencyKey,
      dryRun: request.dryRun,
    });

    if (createResult.outcome === 'UNKNOWN_MUTATION_OUTCOME') {
      this.metrics.ambiguousMutationOutcomes++;

      const reconResult = await provider.reconcile({
        syncKey: request.syncKey,
        idempotencyKey,
      });

      this.metrics.reconciliationAttempts++;

      if (reconResult.state === 'COMMITTED') {
        this.metrics.reconciliationConfirmedCommitted++;
        await this.config.journal.update(journalEntry.id, {
          reconciliationState: 'COMMITTED',
          externalRef: reconResult.externalRef,
        });
        return {
          success: true,
          operation: 'CREATE',
          outcome: 'CONFIRMED_SUCCESS',
          syncKey: request.syncKey,
          providerId: request.providerId,
          externalRef: reconResult.externalRef,
          remoteVersion: reconResult.externalRef?.remoteVersion,
          metrics: { ...this.metrics },
        };
      }

      if (reconResult.state === 'NOT_COMMITTED') {
        this.metrics.reconciliationConfirmedNotCommitted++;

        if (journalEntry.safeRetries < (this.config.maxSafeRetries ?? 3)) {
          await this.config.journal.update(journalEntry.id, {
            safeRetries: journalEntry.safeRetries + 1,
          });
          this.metrics.safeRetries++;

          return this.executeCreate(provider, request, idempotencyKey, {
            ...journalEntry,
            safeRetries: journalEntry.safeRetries + 1,
          });
        }
      }

      this.metrics.reconciliationInconclusive++;
      await this.config.journal.update(journalEntry.id, {
        reconciliationState: 'INCONCLUSIVE',
      });

      return {
        success: false,
        operation: 'CREATE',
        outcome: 'UNKNOWN_MUTATION_OUTCOME',
        syncKey: request.syncKey,
        providerId: request.providerId,
        error: 'Reconciliation inconclusive',
        metrics: { ...this.metrics },
      };
    }

    if (createResult.outcome === 'CONFIRMED_SUCCESS') {
      this.metrics.createCommits++;
      this.metrics.externalRefsPersisted++;
      return {
        success: true,
        operation: 'CREATE',
        outcome: 'CONFIRMED_SUCCESS',
        syncKey: request.syncKey,
        providerId: request.providerId,
        externalRef: createResult.externalRef,
        remoteVersion: createResult.externalRef?.remoteVersion,
        metrics: { ...this.metrics },
      };
    }

    return {
      success: false,
      operation: 'CREATE',
      outcome: createResult.outcome,
      syncKey: request.syncKey,
      providerId: request.providerId,
      error: createResult.error,
      metrics: { ...this.metrics },
    };
  }

  private async executeUpdate(
    provider: MutationProvider,
    request: MutationRequest,
    existingEntry: MutationJournalEntry | null,
    idempotencyKey: string,
    journalEntry: MutationJournalEntry,
  ): Promise<MutationResult> {
    if (!existingEntry?.externalRef) {
      return {
        success: false,
        operation: 'UPDATE',
        outcome: 'CONFIRMED_FAILURE',
        syncKey: request.syncKey,
        providerId: request.providerId,
        error: 'No external reference for update',
        metrics: { ...this.metrics },
      };
    }

    const updateResult = await provider.update({
      syncKey: request.syncKey,
      externalRef: existingEntry.externalRef,
      payload: request.payload,
      expectedRemoteVersion: existingEntry.externalRef.remoteVersion,
      idempotencyKey,
      dryRun: request.dryRun,
    });

    if (updateResult.staleWriteRejected) {
      this.metrics.staleWritesPrevented++;
      return {
        success: false,
        operation: 'UPDATE',
        outcome: 'CONFIRMED_FAILURE',
        syncKey: request.syncKey,
        providerId: request.providerId,
        error: updateResult.error,
        metrics: { ...this.metrics },
      };
    }

    if (updateResult.outcome === 'UNKNOWN_MUTATION_OUTCOME') {
      this.metrics.ambiguousMutationOutcomes++;

      const reconResult = await provider.reconcile({
        syncKey: request.syncKey,
        externalRef: existingEntry.externalRef,
        idempotencyKey,
      });

      this.metrics.reconciliationAttempts++;

      if (reconResult.state === 'COMMITTED') {
        this.metrics.reconciliationConfirmedCommitted++;
        await this.config.journal.update(journalEntry.id, {
          reconciliationState: 'COMMITTED',
          externalRef: reconResult.externalRef,
        });
        return {
          success: true,
          operation: 'UPDATE',
          outcome: 'CONFIRMED_SUCCESS',
          syncKey: request.syncKey,
          providerId: request.providerId,
          externalRef: reconResult.externalRef,
          remoteVersion: reconResult.externalRef?.remoteVersion,
          metrics: { ...this.metrics },
        };
      }

      if (reconResult.state === 'NOT_COMMITTED') {
        this.metrics.reconciliationConfirmedNotCommitted++;

        if (journalEntry.safeRetries < (this.config.maxSafeRetries ?? 3)) {
          await this.config.journal.update(journalEntry.id, {
            safeRetries: journalEntry.safeRetries + 1,
          });
          this.metrics.safeRetries++;

          return this.executeUpdate(provider, request, existingEntry, idempotencyKey, {
            ...journalEntry,
            safeRetries: journalEntry.safeRetries + 1,
          });
        }
      }

      this.metrics.reconciliationInconclusive++;
      await this.config.journal.update(journalEntry.id, {
        reconciliationState: 'INCONCLUSIVE',
      });

      return {
        success: false,
        operation: 'UPDATE',
        outcome: 'UNKNOWN_MUTATION_OUTCOME',
        syncKey: request.syncKey,
        providerId: request.providerId,
        error: 'Reconciliation inconclusive',
        metrics: { ...this.metrics },
      };
    }

    if (updateResult.outcome === 'CONFIRMED_SUCCESS') {
      this.metrics.updateCommits++;
      this.metrics.externalRefsPersisted++;
      return {
        success: true,
        operation: 'UPDATE',
        outcome: 'CONFIRMED_SUCCESS',
        syncKey: request.syncKey,
        providerId: request.providerId,
        externalRef: updateResult.externalRef,
        remoteVersion: updateResult.externalRef?.remoteVersion,
        metrics: { ...this.metrics },
      };
    }

    return {
      success: false,
      operation: 'UPDATE',
      outcome: updateResult.outcome,
      syncKey: request.syncKey,
      providerId: request.providerId,
      error: updateResult.error,
      metrics: { ...this.metrics },
    };
  }

  private generateIdempotencyKey(request: MutationRequest, operation: MutationOperation): string {
    return `${request.providerId}::${request.syncKey}::${operation}`;
  }

  private createInitialMetrics(): MutationMetrics {
    return {
      mutationPlans: 0,
      createAttempts: 0,
      createCommits: 0,
      updateAttempts: 0,
      updateCommits: 0,
      noopDeliveries: 0,
      safeRetries: 0,
      unsafeRetries: 0,
      ambiguousMutationOutcomes: 0,
      reconciliationAttempts: 0,
      reconciliationConfirmedCommitted: 0,
      reconciliationConfirmedNotCommitted: 0,
      reconciliationInconclusive: 0,
      staleWritesPrevented: 0,
      idempotencyKeysUsed: 0,
      idempotentDuplicatesPrevented: 0,
      externalRefsPersisted: 0,
      authorizationBlocks: 0,
      readOnlyBlocks: 0,
      secretLeakCount: 0,
    };
  }

  getMetrics(): MutationMetrics {
    return { ...this.metrics };
  }
}
