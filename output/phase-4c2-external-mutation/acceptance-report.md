# Phase 4C.2: External Mutation Safety & Idempotent Sync — Acceptance Report

**Date:** 2026-08-29
**Branch:** phase-4a-source-ingestion
**Status:** ACCEPTED

---

## Summary

Phase 4C.2 implements safe, idempotent external mutation coordination with deterministic acceptance testing. All 26 acceptance scenarios pass, all regression tests pass, typecheck is clean.

## Deliverables

### New Files

| File | Purpose |
|------|---------|
| `src/mutation-models.ts` | MutationOperation, MutationOutcome, ProviderCapabilities, MutationRequest/Result, ExternalReference, MutationJournalEntry, MutationProvider interface |
| `src/mutation-journal.ts` | InMemoryMutationJournal with syncKey + idempotencyKey indexing |
| `src/mutation-coordinator.ts` | MutationCoordinator with safe retry, reconciliation, dry-run, read-only, stale-write prevention |
| `src/providers/external-fixture.ts` | ExternalFixtureProvider with CREATE/UPDATE/RECONCILE, failure injection, counters, optimistic version guard |
| `tests/mutation-acceptance.test.ts` | 26 deterministic acceptance scenarios (A–Z) |

### Modified Files

| File | Change |
|------|--------|
| `src/index.ts` | Added exports for mutation modules |
| `src/mutation-models.ts` | Re-exported DeliveryKeyId, ProviderId, PayloadFingerprint, OutputTarget |

## Acceptance Scenarios (26/26 PASS)

| # | Scenario | Result |
|---|----------|--------|
| A | First CREATE | PASS |
| B | Exact Replay → NOOP | PASS |
| C | Changed Content → UPDATE | PASS |
| D | Timeout-before-commit → Safe Retry | PASS |
| E | Timeout-after-commit → Reconcile resolves | PASS |
| F | Timeout-after-commit UPDATE → Reconcile resolves | PASS |
| G | Inconclusive Reconciliation → remains unresolved | PASS |
| H | Auth Failure → no retry | PASS |
| I | Authorization Failure → no retry | PASS |
| J | Validation Failure → no retry | PASS |
| K | Transient → Bounded Safe Retry | PASS |
| L | Provider-native Idempotency Replay | PASS |
| M | Stale UPDATE Rejected | PASS |
| N | Older Revision Cannot Overwrite Newer | PASS |
| O | Concurrent CREATE → One Logical Object | PASS |
| P | Concurrent External Update → Stale Second Writer | PASS |
| Q | Provider without UPDATE → Fail Closed | PASS |
| R | Provider without Reconciliation → Unresolved | PASS |
| S | Dry Run → Zero Mutations | PASS |
| T | Read-only → Zero Mutations | PASS |
| U | Source-controlled Destination → Zero Unauthorized Mutation | PASS |
| V | Multi-provider Partial Failure → Isolates Failures | PASS |
| W | Batch Replay Does Not Republish Unchanged | PASS |
| X | Secret Sentinel Scan → Zero Raw Secrets | PASS |
| Y | Scenario3Result Immutability | PASS |
| Z | AI Decisions = 0 | PASS |

## Regression Tests

| Package | Tests | Result |
|---------|-------|--------|
| output-provider | 92 | PASS |
| fingerprint | 32 | PASS |
| evidence-freshness | 15 | PASS |
| impact-graph | 17 | PASS |

## Key Design Decisions

### 1. Idempotency Key Generation
The auto-generated idempotency key uses the **determined operation** (not the request's declared operation). This prevents key collisions between CREATE and UPDATE on the same syncKey.

```
key = `${providerId}::${syncKey}::${determinedOperation}`
```

### 2. NOOP Detection
The coordinator short-circuits to NOOP only when:
- The payload fingerprint matches the previous entry, AND
- The previous outcome was `CONFIRMED_SUCCESS`

This ensures retries after `DEFINITELY_NOT_SENT` are not incorrectly deduplicated.

### 3. UPDATE/canUpdate Fail-Closed
When a provider doesn't support UPDATE but an existing object needs updating (different fingerprint, previous SUCCESS), the coordinator returns `CONFIRMED_FAILURE` with "Provider does not support UPDATE" — not a fallback to CREATE.

### 4. Reconciliation Resolves UNKNOWN Outcomes
When a provider returns `UNKNOWN_MUTATION_OUTCOME` (e.g., timeout-after-commit), the coordinator calls `reconcile()`. If reconciliation determines `COMMITTED`, the outcome is resolved to `CONFIRMED_SUCCESS`. Only inconclusive reconciliation leaves the outcome as `UNKNOWN_MUTATION_OUTCOME`.

### 5. Stale Write Detection
The provider's optimistic version guard rejects updates when `expectedRemoteVersion` doesn't match the current object version. The coordinator increments `staleWritesPrevented` metric.

## Invariants Verified

| Invariant | Status |
|-----------|--------|
| NO BLIND MUTATION RETRIES | PASS — DEFINITELY_NOT_SENT triggers bounded safe retry; UNKNOWN triggers reconciliation |
| UNKNOWN_MUTATION_OUTCOME not treated as definite failure | PASS — reconciliation resolves when possible |
| STALE OUTPUT must not overwrite newer external state | PASS — version guard rejects stale writes |
| Zero AI calls | PASS — all decisions are deterministic |
| Zero secret leaks | PASS — secret sentinel scan passes |
| Read-only mode blocks all mutations | PASS |
| Dry-run mode performs zero mutations | PASS |
| Source-controlled destination blocks unauthorized mutation | PASS |

## Phase Status

| Phase | Status | Commit |
|-------|--------|--------|
| 4A | FROZEN | `20cf811` |
| 4B.1 | FROZEN | `586cd27` |
| 4B.2 | FROZEN | `1cc2ab4` |
| 4B.3 | FROZEN | `184a66d` |
| 4C Audit | FROZEN | `PHASE_4C_IMPLEMENTATION_READY = YES` |
| 4C.1 | FROZEN | `07bfac5`, `8f4ddec` |
| **4C.2** | **ACCEPTED** | pending commit |
