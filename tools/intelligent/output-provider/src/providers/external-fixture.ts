import { randomUUID } from 'node:crypto';
import {
  MutationProvider,
  ProviderCapabilities,
  CreateMutationRequest,
  CreateMutationResult,
  UpdateMutationRequest,
  UpdateMutationResult,
  ReconcileRequest,
  ReconcileResult,
  ExternalReference,
  MutationOutcome,
  ReconciliationState,
  DeliveryKeyId,
} from '../mutation-models.js';
import { PayloadFingerprint } from '../models.js';

// ============================================================================
// External Fixture Provider
// Simulates external system (Jira, GitHub Issues, etc.) for testing
// ============================================================================

export interface ExternalObject {
  id: string;
  syncKey: DeliveryKeyId;
  payload: unknown;
  payloadFingerprint: PayloadFingerprint;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FixtureProviderConfig {
  id?: string;
  capabilities?: Partial<ProviderCapabilities>;
  failureModes?: FailureModes;
}

export interface FailureModes {
  createFails?: boolean;
  updateFails?: boolean;
  reconcileFails?: boolean;
  timeoutBeforeCommit?: boolean;
  timeoutAfterCommit?: boolean;
  authFailure?: boolean;
  authorizationFailure?: boolean;
  validationFailure?: boolean;
  transientFailure?: boolean;
  inconclusiveReconciliation?: boolean;
}

export interface FixtureCounters {
  createAttempts: number;
  createCommits: number;
  updateAttempts: number;
  updateCommits: number;
  lookupAttempts: number;
  objectsCreated: number;
  objectsUpdated: number;
  duplicateObjects: number;
}

export class ExternalFixtureProvider implements MutationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  private objects = new Map<DeliveryKeyId, ExternalObject>();
  private idempotencyStore = new Map<string, DeliveryKeyId>();
  private failureModes: FailureModes;
  private counters: FixtureCounters;

  constructor(config: FixtureProviderConfig = {}) {
    this.id = config.id ?? 'external-fixture';
    this.displayName = 'External Fixture Provider';
    this.capabilities = {
      canCreate: true,
      canUpdate: true,
      canReconcile: true,
      hasIdempotency: true,
      hasVersionGuard: true,
      ...config.capabilities,
    };
    this.failureModes = config.failureModes ?? {};
    this.counters = {
      createAttempts: 0,
      createCommits: 0,
      updateAttempts: 0,
      updateCommits: 0,
      lookupAttempts: 0,
      objectsCreated: 0,
      objectsUpdated: 0,
      duplicateObjects: 0,
    };
  }

  getCounters(): FixtureCounters {
    return { ...this.counters };
  }

  getObjects(): ExternalObject[] {
    return Array.from(this.objects.values());
  }

  getObjectBySyncKey(syncKey: DeliveryKeyId): ExternalObject | undefined {
    return this.objects.get(syncKey);
  }

  resetCounters(): void {
    this.counters = {
      createAttempts: 0,
      createCommits: 0,
      updateAttempts: 0,
      updateCommits: 0,
      lookupAttempts: 0,
      objectsCreated: 0,
      objectsUpdated: 0,
      duplicateObjects: 0,
    };
  }

  setFailureMode(mode: keyof FailureModes, value: boolean): void {
    this.failureModes[mode] = value;
  }

  clearFailureModes(): void {
    this.failureModes = {};
  }

  async create(request: CreateMutationRequest): Promise<CreateMutationResult> {
    if (request.dryRun) {
      return { success: true, outcome: 'CONFIRMED_SUCCESS' };
    }

    this.counters.createAttempts++;

    if (this.failureModes.authFailure) {
      return { success: false, outcome: 'CONFIRMED_FAILURE', error: 'Authentication failed' };
    }

    if (this.failureModes.authorizationFailure) {
      return { success: false, outcome: 'CONFIRMED_FAILURE', error: 'Authorization failed' };
    }

    if (this.failureModes.validationFailure) {
      return { success: false, outcome: 'CONFIRMED_FAILURE', error: 'Validation failed' };
    }

    if (this.failureModes.timeoutBeforeCommit) {
      return { success: false, outcome: 'DEFINITELY_NOT_SENT', error: 'Timeout before commit' };
    }

    if (this.failureModes.createFails) {
      return { success: false, outcome: 'CONFIRMED_FAILURE', error: 'Create failed' };
    }

    if (this.failureModes.transientFailure) {
      return { success: false, outcome: 'DEFINITELY_NOT_SENT', error: 'Transient failure' };
    }

    if (request.idempotencyKey) {
      const existingSyncKey = this.idempotencyStore.get(request.idempotencyKey);
      if (existingSyncKey) {
        const existingObj = this.objects.get(existingSyncKey);
        if (existingObj) {
          this.counters.duplicateObjects++;
          return {
            success: true,
            outcome: 'CONFIRMED_SUCCESS',
            externalRef: this.toExternalRef(existingObj),
          };
        }
      }
    }

    const existing = this.objects.get(request.syncKey);
    if (existing) {
      this.counters.duplicateObjects++;
      return {
        success: true,
        outcome: 'CONFIRMED_SUCCESS',
        externalRef: this.toExternalRef(existing),
      };
    }

    const now = new Date().toISOString();
    const obj: ExternalObject = {
      id: `ext_${randomUUID().slice(0, 8)}`,
      syncKey: request.syncKey,
      payload: request.payload,
      payloadFingerprint: '',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    if (this.failureModes.timeoutAfterCommit) {
      this.objects.set(request.syncKey, obj);
      this.counters.createCommits++;
      this.counters.objectsCreated++;
      if (request.idempotencyKey) {
        this.idempotencyStore.set(request.idempotencyKey, request.syncKey);
      }
      return { success: false, outcome: 'UNKNOWN_MUTATION_OUTCOME', error: 'Timeout after commit' };
    }

    this.objects.set(request.syncKey, obj);
    this.counters.createCommits++;
    this.counters.objectsCreated++;

    if (request.idempotencyKey) {
      this.idempotencyStore.set(request.idempotencyKey, request.syncKey);
    }

    return {
      success: true,
      outcome: 'CONFIRMED_SUCCESS',
      externalRef: this.toExternalRef(obj),
    };
  }

  async update(request: UpdateMutationRequest): Promise<UpdateMutationResult> {
    if (request.dryRun) {
      return { success: true, outcome: 'CONFIRMED_SUCCESS' };
    }

    this.counters.updateAttempts++;

    if (this.failureModes.authFailure) {
      return { success: false, outcome: 'CONFIRMED_FAILURE', error: 'Authentication failed' };
    }

    if (this.failureModes.authorizationFailure) {
      return { success: false, outcome: 'CONFIRMED_FAILURE', error: 'Authorization failed' };
    }

    if (this.failureModes.validationFailure) {
      return { success: false, outcome: 'CONFIRMED_FAILURE', error: 'Validation failed' };
    }

    if (this.failureModes.timeoutBeforeCommit) {
      return { success: false, outcome: 'DEFINITELY_NOT_SENT', error: 'Timeout before commit' };
    }

    if (this.failureModes.updateFails) {
      return { success: false, outcome: 'CONFIRMED_FAILURE', error: 'Update failed' };
    }

    if (this.failureModes.transientFailure) {
      return { success: false, outcome: 'DEFINITELY_NOT_SENT', error: 'Transient failure' };
    }

    const existing = this.objects.get(request.syncKey);
    if (!existing) {
      return { success: false, outcome: 'CONFIRMED_FAILURE', error: 'Object not found for update' };
    }

    if (this.capabilities.hasVersionGuard) {
      if (existing.version !== request.expectedRemoteVersion) {
        return {
          success: false,
          outcome: 'CONFIRMED_FAILURE',
          staleWriteRejected: true,
          error: `Stale write rejected: expected version ${request.expectedRemoteVersion}, got ${existing.version}`,
        };
      }
    }

    if (request.idempotencyKey) {
      const existingSyncKey = this.idempotencyStore.get(request.idempotencyKey);
      if (existingSyncKey && existingSyncKey === request.syncKey) {
        return {
          success: true,
          outcome: 'CONFIRMED_SUCCESS',
          externalRef: this.toExternalRef(existing),
        };
      }
    }

    if (this.failureModes.timeoutAfterCommit) {
      existing.payload = request.payload;
      existing.version++;
      existing.updatedAt = new Date().toISOString();
      this.counters.updateCommits++;
      this.counters.objectsUpdated++;
      return { success: false, outcome: 'UNKNOWN_MUTATION_OUTCOME', error: 'Timeout after commit' };
    }

    existing.payload = request.payload;
    existing.version++;
    existing.updatedAt = new Date().toISOString();
    this.counters.updateCommits++;
    this.counters.objectsUpdated++;

    return {
      success: true,
      outcome: 'CONFIRMED_SUCCESS',
      externalRef: this.toExternalRef(existing),
    };
  }

  async reconcile(request: ReconcileRequest): Promise<ReconcileResult> {
    if (this.failureModes.reconcileFails) {
      return { success: false, state: 'INCONCLUSIVE', error: 'Reconciliation failed' };
    }

    if (this.failureModes.inconclusiveReconciliation) {
      return { success: false, state: 'INCONCLUSIVE', error: 'Cannot determine commit state' };
    }

    if (request.idempotencyKey) {
      const existingSyncKey = this.idempotencyStore.get(request.idempotencyKey);
      if (existingSyncKey) {
        const obj = this.objects.get(existingSyncKey);
        if (obj) {
          return {
            success: true,
            state: 'COMMITTED',
            externalRef: this.toExternalRef(obj),
          };
        }
      }
    }

    if (request.externalRef) {
      const obj = this.objects.get(request.syncKey);
      if (obj && obj.id === request.externalRef.externalId) {
        return {
          success: true,
          state: 'COMMITTED',
          externalRef: this.toExternalRef(obj),
        };
      }
    }

    const obj = this.objects.get(request.syncKey);
    if (obj) {
      return {
        success: true,
        state: 'COMMITTED',
        externalRef: this.toExternalRef(obj),
      };
    }

    return {
      success: true,
      state: 'NOT_COMMITTED',
    };
  }

  private toExternalRef(obj: ExternalObject): ExternalReference {
    return {
      externalId: obj.id,
      providerId: this.id,
      syncKey: obj.syncKey,
      destination: `${this.id}/${obj.id}`,
      remoteVersion: obj.version,
      payloadFingerprint: obj.payloadFingerprint,
      createdAt: obj.createdAt,
      updatedAt: obj.updatedAt,
    };
  }
}
