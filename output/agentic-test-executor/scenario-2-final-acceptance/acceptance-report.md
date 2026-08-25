# TIRAI — SCENARIO 2 FINAL ACCEPTANCE

Decision: ACCEPTED

Audit baseline: `cbf0a1e`
Final source changes: Scenario 2.1 orchestration closure
Branch: `main`

## Closed-loop architecture

`TestCase` → `TestExecutionOrchestrator.run(testCases, dataPlan)` → per-test data-plan selection → `TestExecutionContext.testDataItems` → `JourneyTestExecutor`/`JourneyAgent` → Phase 2B resolution and protected RuntimeBindings → semantic journey → Phase 2D recovery → Phase 2E verification → result classification → executor cleanup → run aggregation/report.

The E2E runner passes its canonical `dataPlan` into the normal orchestrator. Journey/Agentic executors consume the context-selected items; constructor-provided items remain only as backwards-compatible fallback. No separate journey planner or canary-only path is required.

## Fixed blockers

### 1. Phase 2B → Journey bridge

Root cause: the orchestrator did not carry the canonical data plan into executor context; JourneyAgent only read constructor state.

Fix: `TestExecutionOrchestrator.run` accepts the existing `TestDataPlanIR`, selects only the current test case's required/setup/cleanup items, and exposes them through `TestExecutionContext`. JourneyAgent and AgenticTestExecutor prefer those items. `EndToEndRunner` forwards the plan.

Proof: normal orchestrator test passes without constructor `testDataItems`; generated binding `runtime.DATA-0001` reaches the journey. Missing existing data blocks before browser launch and AI calls.

### 2. Run-level BLOCKED semantics

Root cause: aggregation had no blocked branch and could report a blocked-only run as passed.

Fix: blocked results now produce the existing non-clean terminal status `partial`; errors take precedence, then failures, then blocked work, then passed.

Proof: all-blocked run is `partial`, with `blocked` count retained; mixed FAIL/BLOCKED and ERROR/BLOCKED preserve the stronger terminal result. No contradictory clean PASS remains.

### 3. Cleanup after executor exception

Root cause: the orchestrator catch path returned an ERROR without invoking the selected executor cleanup.

Fix: selected executor/context are retained and cleanup is attempted exactly once from the exception path. Cleanup exceptions are represented alongside the original execution error. Normal cleanup failures cannot be overwritten by `completed` phase.

Proof: executor-throw, mid-journey-throw, execute+cleanup-throw, exactly-once, external-existing, and temporary-restore regressions pass.

## Normal execution path

`TestCase` → `TestExecutionOrchestrator` → executor registry → automatic data-plan bridge → Phase 2B coordinator/runtime bindings → Journey execution/recovery/verification → canonical `PASS`/`FAIL`/`BLOCKED`/`ERROR` → cleanup.

Manual test-data wiring required: **NO** for normal platform execution.

## Run semantics

- all blocked: `partial` (not passed), blocked count preserved
- PASS + BLOCKED: `partial`
- FAIL + BLOCKED: `failed`
- ERROR + BLOCKED: `error`
- cleanup failure: execution result is not a clean PASS and cleanup failure is reported

## Acceptance canaries

- Happy closed loop: PASS through `TestExecutionOrchestrator`; automatic generated binding, real Chromium, UI/API verification, cleanup.
- Full recovery closed loop: PASS; controlled stale action classified/recovered, then verification passed.
- Business contradiction: PASS regression; UI success with backend ACTIVE produces test `failed`.
- Missing capability: BLOCKED before browser/AI actions; fabrication count 0.
- Executor infrastructure error: ERROR; cleanup attempted and owned state cleaned.
- Gray-box: PASS; source remains optional and runtime remains authoritative.

### Real AI + Chromium canary

- provider/model: DeepSeek `deepseek-v4-flash`
- AI calls/tokens: 4 calls; 2,033 input / 461 output / 2,494 total
- browser: real Chromium; 3 semantic states; 2 page transitions; 4 actions
- disruption: controlled stale action; 1 failure detected; 1 successful recovery
- data: `runtime.DATA-REAL-AI-MARKER` consumed through the automatic data-plan bridge
- verification: UI + API, `VERIFIED`, 2 acquisitions, 0 verification AI calls
- source: 17 hints available, 4 used, 5 confirmed
- generated selectors: 0; external actions: 0; lifecycle leaks: 0
- result: PASS; orchestrator status `passed`

## Safety counters

All required Scenario 2 counters are zero: `fabricated existing data`, `generated selectors`, `source-direct selectors`, `stale executions`, `blind mutation retries`, `duplicate mutations`, `duplicate preparations`, `invented SQL`, `invented endpoints`, `capability escalation`, `verification mutations`, `production mutations`, `unauthorized external actions`, `raw secrets in AI/artifacts`, `unowned deletes`, `orphans`, `lifecycle leaks`, `uncorrelated evidence used for PASS`, `clean PASS with cleanup failure`, `blocked-only run reported PASS`, and `executor-error cleanup skipped`.

## Regression

- Agentic: 153 passed, 2 skipped
- Planner: 144 passed
- Resolver: 111 passed
- DB: 112 passed, 1 skipped
- API: 148 passed
- UI: 176 passed
- Orchestrator: 147 passed
- Execution Engine: 153 passed
- AI Provider: targeted missing-key regression passed; full suite has 94 passed, 2 skipped when run without the ambient key
- Project Adapter: 157 passed
- E2E Runner: 223 passed
- Typecheck: PASS for changed packages
- Build: PASS for changed packages
- Changed-scope lint: PASS (pre-existing warnings only in E2E CLI/tests; zero errors)

The earlier parallel execution-engine timestamp flake passed on isolated rerun. The AI missing-key test requires the key to be unset; no key value was printed or recorded.

## Frozen-module audit

No Phase 2B–2F contract was redesigned. Minimal generic extension points were used in orchestration context, Journey/Agentic context consumption, and E2E plan forwarding. Regressions cover the concrete integration defects.

## Deferred

- mSale real-environment validation — unavailable and non-blocking
- full browser-process resurrection
- durable cross-process resume
- broader provider/runtime matrix
- unrelated workspace semantic-analyzer lint debt

## Final decision

`SCENARIO 2 = ACCEPTED`
