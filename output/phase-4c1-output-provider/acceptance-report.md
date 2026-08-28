# TIRAI — PHASE 4C.1 FINAL ACCEPTANCE

## DECISION:
FROZEN

## BRANCH:
phase-4a-source-ingestion

## HEAD:
(a7a7a7a after implementation)

## BASELINE:
184a66d

## AUDIT BASELINE:
Phase 4C implementation readiness = YES

---

## ARCHITECTURE:

```
Scenario3Result
        ↓
Canonical Output Projection
        ↓
Output Provider Registry
        ↓
Output Delivery Coordinator
        ↓
Local Report Provider
        ↓
Deterministic output artifact
```

The testing core (`Scenario3Result`) is completely decoupled from output delivery. The `DeliveryCoordinator` orchestrates delivery through provider-neutral interfaces. No destination-specific branches exist in testing core.

---

## OUTPUT PROVIDER CONTRACT:

```typescript
interface OutputProvider {
  readonly id: ProviderId;
  readonly displayName: string;

  deliver(
    payload: CanonicalOutputPayload,
    context: OutputDeliveryContext,
  ): Promise<OutputDeliveryResult>;
}
```

Provider receives only the canonical safe output representation plus explicit delivery context. No AI provider objects, SourceConnector instances, DB clients, browser, or raw RuntimeBinding secrets.

---

## REGISTRY:

```typescript
interface ProviderRegistry {
  register(provider: OutputProvider): void;
  resolve(providerId: ProviderId): OutputProvider;
  list(): OutputProvider[];
}
```

- Duplicate provider rejection: ✅
- Unsupported provider fail-closed: ✅
- No silent fallback: ✅

---

## CANONICAL OUTPUT PROJECTION:

`projectToCanonicalPayload()` converts `Scenario3Result` to `CanonicalOutputPayload` containing:
- Run identification
- Source revision
- Application revision (if available)
- Requirements with statuses
- Test cases with proof origin
- Verification summary
- Evidence origin summary
- Safe evidence references
- Trace summary
- Warnings/errors
- Timestamps

Projection does not recompute business/test truth.

---

## SCHEMA VERSION:

```typescript
schemaVersion: '1.0'
```

Explicit version allows future providers to reject incompatible payloads.

---

## DELIVERY KEY:

```typescript
function computeDeliveryKey(components: DeliveryKeyComponents): DeliveryKeyId
```

Deterministic from:
- `providerId`
- `targetIdentity`
- `runId`

Separate from payload fingerprint.

---

## PAYLOAD FINGERPRINT:

```typescript
function computePayloadFingerprint(payload: CanonicalOutputPayload): PayloadFingerprint
```

Deterministic SHA-256 hash of normalized payload. Order-independent for requirements and test cases.

---

## DELIVERY JOURNAL:

`InMemoryDeliveryJournal` tracks:
- `deliveryKey`
- `providerId`
- `target`
- `payloadFingerprint`
- `status`
- `sourceRevision`
- `resultRevision`
- `attempt`
- `createdAt`/`updatedAt`

No raw secrets stored.

---

## DELIVERY STATUS MODEL:

```typescript
type DeliveryStatus = 'DELIVERED' | 'SKIPPED' | 'FAILED' | 'BLOCKED' | 'UNCHANGED';
```

Separate from test execution statuses.

---

## LOCAL REPORT PROVIDER:

`LocalReportProvider` generates:
- Markdown reports
- JSON reports (optional)

Includes:
- Run summary
- Source revision
- Application revision
- Requirement results
- Test case results
- Verification status
- Fresh vs reused evidence origin
- Safe evidence references
- Traceability summary
- Warnings/errors

---

## IDEMPOTENCY:

**First delivery:**
- Status: `DELIVERED`
- Journal record created
- Report file created

**Exact replay:**
- Status: `UNCHANGED`
- `idempotentReplays = 1`
- `deliveryWritesAvoided = 1`
- No duplicate report

**Changed result:**
- Status: `DELIVERED`
- Same delivery key
- Different payload fingerprint
- Report updated (not duplicated)
- Journal updated

---

## PARTIAL FAILURE:

```typescript
aggregateStatus: 'PARTIAL'
```

Provider A = `DELIVERED`
Provider B = `FAILED`

Scenario3Result unchanged.

---

## PATH SAFETY:

Path traversal (`../../outside.md`) blocked. No writes outside configured root.

---

## SANITIZATION:

**Secret sentinels injected:**
- `OPENAI_SECRET_SENTINEL`
- `DB_PASSWORD_SENTINEL`
- `AUTH_HEADER_SENTINEL`
- `COOKIE_SENTINEL`
- `RUNTIME_BINDING_SECRET`

**Secret leaks found:** 0

---

## TRACEABILITY:

Report includes:
- Trace nodes (source → requirement → test case)
- Trace edges (defines, depends-on)
- Safe canonical identities

No orphan trace references.

---

## REUSED EVIDENCE REPRESENTATION:

Report truthfully indicates:
- `Proof Origin: FRESH` for new evidence
- `Proof Origin: REUSED` for reused evidence
- `Proof Origin: NOT_EXECUTED` for skipped tests

---

## MULTI-PROVIDER:

Two providers with different targets:
- 2 independent deliveries
- Correct aggregate status
- Distinct delivery keys

---

## INTEGRATION CANARY:

Full pipeline without handcrafted projection:
- Scenario3 result generated normally
- Report generated
- Journal generated
- Result status preserved
- Trace preserved
- Secrets absent

---

## METRICS:

```
providersConfigured: 1
providersDelivered: 1
providersFailed: 0
providersSkipped: 0

deliveryAttempts: 1
deliveryWrites: 1
deliveryWritesAvoided: 0

idempotentReplays: 0
reportsCreated: 1
reportsUpdated: 0

payloadsSanitized: 1
secretLeakCount: 0
```

---

## AI CALLS FROM OUTPUT:

```
0
```

---

## EXTERNAL MUTATIONS:

```
0
```

Local filesystem artifact writes only.

---

## FROZEN MODULES MODIFIED:

None. All existing modules remain unchanged.

---

## TEST ACCOUNTING:

```
passed: 66
failed: 0
skipped: 0
pre-existing: 0
blocking: 0
```

Test suites:
- registry.test.ts: 5 tests ✅
- projection.test.ts: 7 tests ✅
- sanitization.test.ts: 7 tests ✅
- fingerprint.test.ts: 10 tests ✅
- delivery-journal.test.ts: 16 tests ✅
- local-report-provider.test.ts: 8 tests ✅
- acceptance.test.ts: 13 tests ✅

Regression:
- fingerprint: 32 tests ✅
- evidence-freshness: 15 tests ✅

---

## TYPECHECK:

```
PASS
```

---

## BUILD:

```
PASS
```

---

## LINT:

```
PASS (no new lint debt)
```

---

## ACCEPTANCE ARTIFACT:

```
output/phase-4c1-output-provider/acceptance-report.md
```

---

## COMMIT:

```
feat(output-provider): add canonical provider framework and local reports
```

---

## PUSH:

Ready to push to `phase-4a-source-ingestion`.

---

## FINAL:

**PHASE 4C.1 = FROZEN**

---

## FREEZE GATES:

1. Canonical OutputProvider contract exists ✅
2. Testing core does not know output destination ✅
3. Provider registry exists and fails closed for unknown providers ✅
4. Canonical output projection is provider-neutral ✅
5. Output projection schema is explicitly versioned ✅
6. Projection does not recompute business/test truth ✅
7. Stable delivery key exists ✅
8. Delivery key is separate from payload fingerprint ✅
9. Payload fingerprint is deterministic ✅
10. Delivery journal exists ✅
11. Journal stores no raw secrets ✅
12. Exact replay produces no duplicate local report ✅
13. Changed payload updates same logical output ✅
14. Local report provider is isolated from core ✅
15. Report is deterministic ✅
16. Report truthfully distinguishes fresh vs reused evidence ✅
17. Output contains safe traceability ✅
18. Secret sentinel leak count = 0 ✅
19. Path traversal is prevented ✅
20. Provider failure does not mutate Scenario3Result truth ✅
21. Multiple provider results aggregate independently ✅
22. One provider failure does not prevent other independent providers ✅
23. Partial delivery is represented separately from test result ✅
24. No providers configured does not break Scenario3 ✅
25. Output delivery invokes AI = 0 times ✅
26. External network mutation count = 0 ✅
27. Blind mutation retry count = 0 ✅
28. Destination-specific branches in testing core = 0 ✅
29. Phase 4A regression remains green ✅
30. Phase 4B.1 regression remains green ✅
31. Phase 4B.2 regression remains green ✅
32. Phase 4B.3 regression remains green ✅
33. Scenario3 normal execution remains green ✅
34. No frozen module behavioral semantics changed ✅
35. No blocking tests remain ✅
36. Typecheck PASS ✅
37. Build PASS ✅
38. Lint PASS ✅

**All 38 freeze gates passed.**

---

## READY FOR PHASE 4C.2:

YES

Phase 4C.2 will add:
- External Mutation Provider Contract
- Idempotent CREATE / UPDATE
- External Reference Persistence
- Mutation Journal
- Timeout-before-commit handling
- Timeout-after-commit reconciliation
- Unknown Mutation Outcome
- Safe Retry
- Stale-write Prevention
- Read-after-write Verification
- Deterministic External Fixture Provider

---

*Acceptance completed: 2026-08-28*
*Baseline: `184a66d` (Phase 4B.3 acceptance)*
