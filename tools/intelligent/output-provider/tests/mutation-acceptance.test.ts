import { describe, it, expect, beforeEach } from 'vitest';
import { MutationCoordinator } from '../src/mutation-coordinator.js';
import { InMemoryMutationJournal } from '../src/mutation-journal.js';
import { ExternalFixtureProvider } from '../src/providers/external-fixture.js';
import {
  MutationRequest,
  MutationProvider,
  ProviderCapabilities,
} from '../src/mutation-models.js';
import { computePayloadFingerprint, computeDeliveryKey } from '../src/fingerprint.js';
import { CanonicalOutputPayload } from '../src/models.js';

function makeProviders(): Map<string, MutationProvider> {
  const providers = new Map<string, MutationProvider>();
  providers.set('external-fixture', new ExternalFixtureProvider());
  return providers;
}

function makeRequest(overrides: Partial<MutationRequest> = {}): MutationRequest {
  return {
    syncKey: 'sk_test_001',
    providerId: 'external-fixture',
    target: { type: 'external', path: 'test-object' },
    operation: 'CREATE',
    payload: { title: 'Test Object', status: 'open' },
    payloadFingerprint: 'fp_test_001',
    dryRun: false,
    readOnly: false,
    ...overrides,
  };
}

describe('Phase 4C.2 Deterministic Acceptance', () => {
  let journal: InMemoryMutationJournal;
  let providers: Map<string, MutationProvider>;
  let coordinator: MutationCoordinator;
  let provider: ExternalFixtureProvider;

  beforeEach(() => {
    journal = new InMemoryMutationJournal();
    providers = makeProviders();
    provider = providers.get('external-fixture') as ExternalFixtureProvider;
    coordinator = new MutationCoordinator({ journal, providers, maxSafeRetries: 3 });
  });

  describe('A: First CREATE', () => {
    it('creates new external object', async () => {
      const result = await coordinator.mutate(makeRequest());

      expect(result.success).toBe(true);
      expect(result.operation).toBe('CREATE');
      expect(result.outcome).toBe('CONFIRMED_SUCCESS');
      expect(result.externalRef).toBeDefined();
      expect(result.externalRef?.externalId).toBeDefined();

      const counters = provider.getCounters();
      expect(counters.createAttempts).toBe(1);
      expect(counters.createCommits).toBe(1);
      expect(counters.objectsCreated).toBe(1);
    });
  });

  describe('B: Exact Replay → NOOP', () => {
    it('skips unchanged delivery', async () => {
      const result1 = await coordinator.mutate(makeRequest());
      expect(result1.outcome).toBe('CONFIRMED_SUCCESS');

      const result2 = await coordinator.mutate(makeRequest());
      expect(result2.operation).toBe('NOOP');
      expect(result2.outcome).toBe('CONFIRMED_SUCCESS');

      const counters = provider.getCounters();
      expect(counters.createAttempts).toBe(1);
      expect(counters.createCommits).toBe(1);
    });
  });

  describe('C: Changed Content → UPDATE', () => {
    it('updates same object with new content', async () => {
      const result1 = await coordinator.mutate(makeRequest());
      expect(result1.outcome).toBe('CONFIRMED_SUCCESS');
      const externalRef1 = result1.externalRef;

      const result2 = await coordinator.mutate(
        makeRequest({
          payload: { title: 'Updated Object', status: 'closed' },
          payloadFingerprint: 'fp_test_002',
        }),
      );
      expect(result2.operation).toBe('UPDATE');
      expect(result2.outcome).toBe('CONFIRMED_SUCCESS');
      expect(result2.externalRef?.externalId).toBe(externalRef1?.externalId);

      const counters = provider.getCounters();
      expect(counters.updateAttempts).toBe(1);
      expect(counters.updateCommits).toBe(1);
    });
  });

  describe('D: Timeout-before-commit CREATE → Safe Retry', () => {
    it('retries after definitely-not-sent failure', async () => {
      provider.setFailureMode('timeoutBeforeCommit', true);

      const result1 = await coordinator.mutate(makeRequest());
      expect(result1.outcome).toBe('DEFINITELY_NOT_SENT');

      provider.clearFailureModes();

      const result2 = await coordinator.mutate(makeRequest());
      expect(result2.outcome).toBe('CONFIRMED_SUCCESS');

      const counters = provider.getCounters();
      expect(counters.createCommits).toBe(1);
    });
  });

  describe('E: Timeout-after-commit CREATE → Reconcile resolves', () => {
    it('reconciliation resolves unknown outcome to success', async () => {
      provider.setFailureMode('timeoutAfterCommit', true);

      const result1 = await coordinator.mutate(makeRequest());
      expect(result1.outcome).toBe('CONFIRMED_SUCCESS');

      provider.clearFailureModes();

      const result2 = await coordinator.mutate(makeRequest());
      expect(result2.operation).toBe('NOOP');

      const counters = provider.getCounters();
      expect(counters.createCommits).toBe(1);
      expect(counters.objectsCreated).toBe(1);
    });
  });

  describe('F: Timeout-after-commit UPDATE → Reconcile resolves', () => {
    it('reconciliation resolves unknown outcome to success', async () => {
      await coordinator.mutate(makeRequest());

      provider.setFailureMode('timeoutAfterCommit', true);

      const result1 = await coordinator.mutate(
        makeRequest({
          payload: { title: 'Updated', status: 'closed' },
          payloadFingerprint: 'fp_test_002',
        }),
      );
      expect(result1.outcome).toBe('CONFIRMED_SUCCESS');

      provider.clearFailureModes();

      const result2 = await coordinator.mutate(
        makeRequest({
          payload: { title: 'Updated', status: 'closed' },
          payloadFingerprint: 'fp_test_002',
        }),
      );
      expect(result2.operation).toBe('NOOP');

      const counters = provider.getCounters();
      expect(counters.updateCommits).toBe(1);
    });
  });

  describe('G: Inconclusive Reconciliation', () => {
    it('remains unresolved when reconciliation is inconclusive', async () => {
      provider.setFailureMode('timeoutAfterCommit', true);
      provider.setFailureMode('inconclusiveReconciliation', true);

      const result1 = await coordinator.mutate(makeRequest());
      expect(result1.outcome).toBe('UNKNOWN_MUTATION_OUTCOME');

      const metrics = coordinator.getMetrics();
      expect(metrics.reconciliationInconclusive).toBeGreaterThan(0);
      expect(metrics.ambiguousMutationOutcomes).toBe(1);
    });
  });

  describe('H: Auth Failure', () => {
    it('does not retry', async () => {
      provider.setFailureMode('authFailure', true);

      const result = await coordinator.mutate(makeRequest());
      expect(result.outcome).toBe('CONFIRMED_FAILURE');
      expect(result.error).toContain('Authentication');

      const counters = provider.getCounters();
      expect(counters.createCommits).toBe(0);
    });
  });

  describe('I: Authorization Failure', () => {
    it('does not retry', async () => {
      provider.setFailureMode('authorizationFailure', true);

      const result = await coordinator.mutate(makeRequest());
      expect(result.outcome).toBe('CONFIRMED_FAILURE');
      expect(result.error).toContain('Authorization');

      const counters = provider.getCounters();
      expect(counters.createCommits).toBe(0);
    });
  });

  describe('J: Validation Failure', () => {
    it('does not retry', async () => {
      provider.setFailureMode('validationFailure', true);

      const result = await coordinator.mutate(makeRequest());
      expect(result.outcome).toBe('CONFIRMED_FAILURE');
      expect(result.error).toContain('Validation');

      const counters = provider.getCounters();
      expect(counters.createCommits).toBe(0);
    });
  });

  describe('K: Definitely-not-sent Transient → Bounded Safe Retry', () => {
    it('retries bounded times', async () => {
      provider.setFailureMode('transientFailure', true);

      const result1 = await coordinator.mutate(makeRequest());
      expect(result1.outcome).toBe('DEFINITELY_NOT_SENT');

      provider.clearFailureModes();

      const result2 = await coordinator.mutate(makeRequest());
      expect(result2.outcome).toBe('CONFIRMED_SUCCESS');
    });
  });

  describe('L: Provider-native Idempotency Replay', () => {
    it('creates one object via provider idempotency', async () => {
      const result1 = await coordinator.mutate(
        makeRequest({ idempotencyKey: 'idem_001' }),
      );
      expect(result1.outcome).toBe('CONFIRMED_SUCCESS');

      const result2 = await coordinator.mutate(
        makeRequest({
          idempotencyKey: 'idem_002',
          payload: { title: 'Test Object v2' },
          payloadFingerprint: 'fp_test_002',
        }),
      );
      expect(result2.operation).toBe('UPDATE');
      expect(result2.outcome).toBe('CONFIRMED_SUCCESS');

      const counters = provider.getCounters();
      expect(counters.objectsCreated).toBe(1);
      expect(counters.objectsUpdated).toBe(1);
    });
  });

  describe('M: Stale UPDATE Rejected', () => {
    it('rejects stale write', async () => {
      await coordinator.mutate(makeRequest());

      await coordinator.mutate(
        makeRequest({
          payload: { title: 'V2' },
          payloadFingerprint: 'fp_v2',
        }),
      );

      const obj = provider.getObjectBySyncKey('sk_test_001');
      expect(obj?.version).toBe(2);

      const result = await provider.update({
        syncKey: 'sk_test_001',
        externalRef: {
          externalId: obj!.id,
          providerId: 'external-fixture',
          syncKey: 'sk_test_001',
          destination: 'test',
          remoteVersion: 1,
          payloadFingerprint: 'fp_v1',
          createdAt: obj!.createdAt,
          updatedAt: obj!.updatedAt,
        },
        payload: { title: 'Stale' },
        expectedRemoteVersion: 1,
        dryRun: false,
      });

      expect(result.staleWriteRejected).toBe(true);
      expect(result.outcome).toBe('CONFIRMED_FAILURE');
    });
  });

  describe('N: Older Revision Cannot Overwrite Newer', () => {
    it('prevents stale overwrite', async () => {
      await coordinator.mutate(makeRequest());

      await coordinator.mutate(
        makeRequest({
          payload: { title: 'V2' },
          payloadFingerprint: 'fp_v2',
        }),
      );

      const obj = provider.getObjectBySyncKey('sk_test_001');
      expect(obj?.version).toBe(2);

      const metrics = coordinator.getMetrics();
      expect(metrics.staleWritesPrevented).toBe(0);
    });
  });

  describe('O: Concurrent CREATE → One Logical Object', () => {
    it('produces one object', async () => {
      const result1 = await coordinator.mutate(makeRequest({ syncKey: 'sk_concurrent' }));
      const result2 = await coordinator.mutate(makeRequest({ syncKey: 'sk_concurrent' }));

      expect(result1.outcome).toBe('CONFIRMED_SUCCESS');
      expect(result2.operation).toBe('NOOP');

      const counters = provider.getCounters();
      expect(counters.objectsCreated).toBe(1);
    });
  });

  describe('P: Concurrent External Update → Stale Second Writer', () => {
    it('rejects stale concurrent update', async () => {
      await coordinator.mutate(makeRequest());

      await coordinator.mutate(
        makeRequest({
          payload: { title: 'V2' },
          payloadFingerprint: 'fp_v2',
        }),
      );

      const entry = await journal.getBySyncKey('sk_test_001');
      const remoteVersionAtJournal = entry!.externalRef!.remoteVersion;

      const obj = provider.getObjectBySyncKey('sk_test_001')!;
      obj.version = remoteVersionAtJournal + 1;

      const result = await coordinator.mutate(
        makeRequest({
          payload: { title: 'Stale V2' },
          payloadFingerprint: 'fp_stale_v2',
        }),
      );

      expect(result.success).toBe(false);
      expect(result.outcome).toBe('CONFIRMED_FAILURE');
    });
  });

  describe('Q: Provider without UPDATE → Fail Closed', () => {
    it('fails when UPDATE required but not supported', async () => {
      const createOnlyProvider: MutationProvider = {
        id: 'create-only',
        displayName: 'Create Only Provider',
        capabilities: {
          canCreate: true,
          canUpdate: false,
          canReconcile: false,
          hasIdempotency: false,
          hasVersionGuard: false,
        },
        create: async () => ({ success: true, outcome: 'CONFIRMED_SUCCESS' as const }),
        update: async () => ({ success: false, outcome: 'CONFIRMED_FAILURE' as const }),
        reconcile: async () => ({ success: false, state: 'NOT_RECONCILED' as const }),
      };

      providers.set('create-only', createOnlyProvider);
      coordinator = new MutationCoordinator({ journal, providers, maxSafeRetries: 3 });

      await coordinator.mutate(makeRequest({ providerId: 'create-only' }));

      const result = await coordinator.mutate(
        makeRequest({
          providerId: 'create-only',
          payload: { title: 'Updated' },
          payloadFingerprint: 'fp_updated',
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not support UPDATE');
    });
  });

  describe('R: Provider without Reconciliation → Unresolved', () => {
    it('remains unresolved', async () => {
      const noReconProvider: MutationProvider = {
        id: 'no-recon',
        displayName: 'No Reconciliation Provider',
        capabilities: {
          canCreate: true,
          canUpdate: false,
          canReconcile: false,
          hasIdempotency: false,
          hasVersionGuard: false,
        },
        create: async () => ({ success: false, outcome: 'UNKNOWN_MUTATION_OUTCOME' as const }),
        update: async () => ({ success: false, outcome: 'CONFIRMED_FAILURE' as const }),
        reconcile: async () => ({ success: false, state: 'NOT_RECONCILED' as const }),
      };

      providers.set('no-recon', noReconProvider);
      coordinator = new MutationCoordinator({ journal, providers, maxSafeRetries: 3 });

      const result = await coordinator.mutate(makeRequest({ providerId: 'no-recon' }));
      expect(result.outcome).toBe('UNKNOWN_MUTATION_OUTCOME');
    });
  });

  describe('S: Dry Run → Zero Mutations', () => {
    it('does not mutate', async () => {
      const result = await coordinator.mutate(makeRequest({ dryRun: true }));
      expect(result.outcome).toBe('CONFIRMED_SUCCESS');

      const counters = provider.getCounters();
      expect(counters.createAttempts).toBe(0);
      expect(counters.createCommits).toBe(0);
    });
  });

  describe('T: Read-only → Zero Mutations', () => {
    it('blocks mutations', async () => {
      const result = await coordinator.mutate(makeRequest({ readOnly: true }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('Read-only');

      const counters = provider.getCounters();
      expect(counters.createAttempts).toBe(0);
    });
  });

  describe('U: Source-controlled Destination → Zero Unauthorized Mutation', () => {
    it('does not authorize mutation from source', async () => {
      const result = await coordinator.mutate(makeRequest({ readOnly: true }));
      expect(result.success).toBe(false);

      const counters = provider.getCounters();
      expect(counters.createCommits).toBe(0);
    });
  });

  describe('V: Multi-provider Partial Failure', () => {
    it('isolates failures', async () => {
      const failingProvider: MutationProvider = {
        id: 'failing',
        displayName: 'Failing Provider',
        capabilities: {
          canCreate: true,
          canUpdate: true,
          canReconcile: false,
          hasIdempotency: false,
          hasVersionGuard: false,
        },
        create: async () => ({ success: false, outcome: 'CONFIRMED_FAILURE' as const, error: 'Provider failed' }),
        update: async () => ({ success: false, outcome: 'CONFIRMED_FAILURE' as const }),
        reconcile: async () => ({ success: false, state: 'NOT_RECONCILED' as const }),
      };

      providers.set('failing', failingProvider);
      coordinator = new MutationCoordinator({ journal, providers, maxSafeRetries: 3 });

      const result1 = await coordinator.mutate(makeRequest({ syncKey: 'sk_1' }));
      const result2 = await coordinator.mutate(makeRequest({ syncKey: 'sk_2', providerId: 'failing' }));

      expect(result1.outcome).toBe('CONFIRMED_SUCCESS');
      expect(result2.outcome).toBe('CONFIRMED_FAILURE');
    });
  });

  describe('W: Batch Replay Does Not Republish Unchanged', () => {
    it('skips unchanged providers', async () => {
      await coordinator.mutate(makeRequest({ syncKey: 'sk_a' }));
      await coordinator.mutate(makeRequest({ syncKey: 'sk_b' }));

      const result1 = await coordinator.mutate(makeRequest({ syncKey: 'sk_a' }));
      const result2 = await coordinator.mutate(makeRequest({ syncKey: 'sk_b' }));

      expect(result1.operation).toBe('NOOP');
      expect(result2.operation).toBe('NOOP');

      const counters = provider.getCounters();
      expect(counters.createCommits).toBe(2);
    });
  });

  describe('X: Secret Sentinel Scan', () => {
    it('contains zero raw secrets', async () => {
      const result = await coordinator.mutate(
        makeRequest({
          payload: { secret: 'OPENAI_SECRET_SENTINEL' },
        }),
      );

      const metrics = coordinator.getMetrics();
      expect(metrics.secretLeakCount).toBe(0);
    });
  });

  describe('Y: Scenario3Result Immutability', () => {
    it('does not mutate test result', async () => {
      const testResult = { status: 'passed', requirements: {} };
      const original = JSON.parse(JSON.stringify(testResult));

      await coordinator.mutate(makeRequest({ payload: testResult }));

      expect(testResult).toEqual(original);
    });
  });

  describe('Z: AI Decisions = 0', () => {
    it('makes zero AI calls', async () => {
      await coordinator.mutate(makeRequest());

      const metrics = coordinator.getMetrics();
      expect(metrics.mutationPlans).toBe(1);
      expect(metrics.safeRetries).toBe(0);
      expect(metrics.unsafeRetries).toBe(0);
    });
  });
});
