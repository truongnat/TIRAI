# TIRAI — PHASE 2E FINAL ACCEPTANCE

## Decision

**PHASE 2E = FROZEN**

Phase 2E adds run-scoped VerificationNeed planning, read-only source adapters,
grounded normalization, entity correlation, assertion-specific authority,
bounded consistency reads, deterministic evaluation, and verification before
cleanup. No Phase 2B/2C/2D contract was reopened.

## Architecture

TestCase → Phase 2B RuntimeBindings → Journey → Phase 2D recovery →
VerificationNeed → capability-grounded UI/API/DB evidence → normalization →
entity correlation → deterministic evaluation → result → cleanup.

## Verification model and safety

- Sources: UI, API, DATABASE.
- A VerificationNeed describes subject, property and expectation; it contains
  no SQL, endpoint or selector.
- Source adapters are required to declare `readOnly: true`.
- Missing required capability is `INSUFFICIENT_EVIDENCE`/BLOCKED semantics;
  acquisition failure is ERROR semantics.
- Normalized status values are supplied by source metadata. Unknown mappings
  remain insufficient evidence; no numeric status is guessed.
- Correlation uses an exact runtime/business identity. Wrong or ambiguous
  entities cannot contribute to PASS.
- Authority is per assertion; there is no global DB/API/UI ranking or majority
  vote.
- Verification runs before Journey cleanup.

## Deterministic Phase 2E matrix

Verification suite: **11 passed**.

Covered: UI/API agreement; UI/DB/three-layer agreement; backend contradiction;
UI-only verification without backend calls; missing required capability;
acquisition error; unknown mapping; wrong/ambiguous correlation; delta;
negative absence; bounded eventual consistency; and rejection of non-read-only
verification sources.

Browser contradiction acceptance: **1 passed**. UI displayed `Completed`, the
correlated API returned `ACTIVE`, and the platform result was `FAIL`; cleanup
still completed.

## Real cross-layer canary

- Environment: disposable local fixture, sanitized.
- Execution: TestExecutionOrchestrator → JourneyTestExecutor.
- Provider/model: DeepSeek / `deepseek-v4-flash`.
- AI journey calls: **8**.
- AI verification calls: **0**; structural equality was deterministic.
- Tokens: **4,871 input / 715 output / 5,586 total**.
- Chromium: real; lifecycle balanced.
- Semantic states: 3 unique; transitions: 2; actions: 4.
- Runtime disruption: controlled stale action; Phase 2D recovery succeeded.
- VerificationNeed: correlated `ITEM-001.status == COMPLETED`.
- Evidence: UI + API; acquisitions: 2; conflicts: 0.
- Backend reads: 1 API GET; backend mutations: 0.
- Result: **VERIFIED / PASS**.

## Evidence and security

- Normalized facts are source/provenance tagged and compact; raw payloads are
  not persisted.
- Raw secrets in AI/artifacts: **0**.
- Production mutations: **0**.
- Unauthorized external actions: **0**.
- Generated selectors: **0**.
- Stale executions: **0**.
- Duplicate mutations: **0**.
- Orphans: **0**.
- Lifecycle leaks: **0**.

## Regression

- Agentic: **145 passed, 2 skipped**.
- Phase 2E verification: **11 passed**.
- Browser contradiction: **1 passed**.
- Planner: **144 passed**.
- Resolver: **111 passed**.
- DB: **112 passed, 1 skipped**.
- API: **148 passed**.
- UI: **176 passed**.
- Orchestrator: **144 passed**.
- Execution Engine: **153 passed**.
- AI Provider: **94 passed, 2 skipped**.
- Typecheck: **PASS**.
- Build: **PASS**.
- Changed-scope lint: **PASS**.

Workspace-wide lint retains exactly two pre-existing semantic-analyzer errors;
they are unrelated to Phase 2E and were not modified.

## Frozen modules and deferred items

No frozen Phase 2B/2C/2D module was changed. Generic verification code contains
no application-specific tables, columns, endpoints, status codes, routes or
selectors. Fixture-only metadata contains the disposable API route.

Deferred: mSale validation; full browser-process resurrection; durable
cross-process resume; real company DB environment validation when such a
safe capability is available. These do not block the generic Phase 2E freeze.
