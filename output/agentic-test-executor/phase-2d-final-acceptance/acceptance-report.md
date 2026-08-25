# TIRAI — PHASE 2D FINAL ACCEPTANCE

## Decision

**PHASE 2D = FROZEN**

The three Phase 2D.1 blockers are covered by deterministic runtime tests. The real DeepSeek + Chromium recovery canary remains green. Full browser-process resurrection and durable cross-process resume are explicitly deferred.

## Baseline and architecture

- Baseline: `1d85def`
- Runtime: TestCase → Orchestrator → Phase 2B RuntimeBindings → Journey Agent → failure classification → bounded recovery policy → reconciliation or reauthentication/context recovery → fresh observation/grounding → assertion → cleanup.

## Former blockers

### Session expiry

- Detection uses current observed authentication state, not URL text alone.
- Protected sensitive RuntimeBindings permit deterministic credential injection; the AI receives only `credentialBindingAvailable=true`.
- Reauthentication is bounded by `maxReauthAttempts` and restores the active semantic goal without rerunning Phase 2B preparation.
- Missing credentials produce `BLOCKED`; no login action or fabricated secret.
- Deterministic coverage: session recovery PASS, missing credential BLOCKED.

### Active page/popup loss

- Lost active pages are classified separately from context loss.
- A trusted opener or single allowed-origin remaining page is selected by page identity/opener relation, never by arbitrary index.
- The selected page is freshly observed and old page grounding is invalidated.
- Ambiguous alternatives are BLOCKED; no trusted page is ERROR/blocked by the existing context policy. Full browser-process resurrection is deferred.
- Deterministic coverage: popup closes, opener recovery PASS.

### Ambiguous outcome reconciliation

- Ambiguous mutating outcomes never blind-retry.
- A reconciliation adapter may return `RECONCILED_SUCCESS` only with a trusted binding, `TEST_OWNED` ownership, journal reference and cleanup callback. The binding is adopted and cleanup responsibility is registered.
- `STILL_AMBIGUOUS` remains BLOCKED; reconciliation infrastructure failure is ERROR. No duplicate mutation is performed.
- Deterministic coverage: safe BLOCKED and reconciled-success PASS.

## Deterministic evidence

Phase 2D recovery suite: **6 passed**.

- stale action → `STALE_STATE` → reobserve/reground → PASS;
- ambiguous mutation → `AMBIGUOUS_OUTCOME` → no replay → BLOCKED;
- active popup loss → trusted opener recovery → PASS;
- session expiry → protected reauthentication → semantic restoration → PASS;
- session expiry without credential → BLOCKED;
- ambiguous mutation proven successful → binding/ownership/cleanup registered, no replay → PASS.

## Real AI + Chromium recovery canary

- Environment: disposable local fixture, sanitized.
- Execution: `TestExecutionOrchestrator` → `JourneyTestExecutor`.
- Provider/model: DeepSeek / `deepseek-v4-flash`.
- AI calls: **8**.
- Tokens: **4,871 input / 763 output / 5,634 total**.
- Chromium: real; browser/context lifecycle balanced (1/1).
- Semantic states: 3 unique, 5 observations; transitions: 2.
- Disruption: controlled stale action failure.
- Classification: `STALE_STATE`.
- Recovery: `REGROUND`, successful; fresh observation/grounding: yes.
- Final result: **PASS**.

## Retry and side-effect safety

| Layer | Retry owner | Safety |
|---|---|---|
| AI provider | transport/status retry | bounded provider policy |
| Journey | semantic recovery/reobserve/reground | bounded recovery budget |
| API/DB | existing idempotency/reconciliation contracts | no unknown blind replay |
| Orchestrator | none | no retry amplification |

Counters: blind mutation retries **0**; duplicate mutations **0**; duplicate preparation **0**; unjournaled reconciled resources **0**.

## Security and cleanup

- Raw secrets in AI prompts/history/artifacts: **0**.
- Session tokens/cookies persisted: **0**.
- Generated selectors: **0**.
- Stale executions: **0**.
- Production mutations: **0**.
- Unauthorized external actions: **0**.
- Orphans: **0**; lifecycle leaks: **0**.

## Regression and verification

- Agentic Test Executor: **133 passed, 2 skipped**.
- Recovery tests: **6 passed**.
- Test Data Planner: **144 passed**.
- Data Resolver: **111 passed**.
- Database Executor: **112 passed, 1 skipped**.
- API Executor: **148 passed**.
- UI Executor: **176 passed**.
- Test Execution Orchestrator: **144 passed**.
- Execution Engine: **153 passed**.
- AI Provider: **94 passed, 2 skipped** (run with empty API-key environment for deterministic configuration isolation).
- Typecheck: **PASS**.
- Build: **PASS**.
- Changed-scope lint: **PASS**.

Workspace-wide lint still reports two unchanged historical semantic-analyzer errors (`consolidationRequestEstimate` and `summaryRequestEstimate` unused); no Phase 2D file is implicated.

## Frozen modules

No Phase 2B executor/data contracts were modified. Changes are limited to the generic Agentic Journey recovery layer, its public recovery types, fixtures and tests.

## Deferred

- mSale real-environment validation: unavailable and non-blocking.
- Full Chromium process resurrection.
- Durable recovery across host-process restart or cross-machine resume.
- Arbitrary third-party IdP recovery.

These do not invalidate the Phase 2D runtime recovery contract.
