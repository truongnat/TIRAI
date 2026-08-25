# TIRAI — SCENARIO 3 FINAL ACCEPTANCE

Decision: **NOT ACCEPTED**

HEAD at audit start: `2939aea`

## Original blocker and root cause

The original 240-second Vitest boundary expired while the real pipeline was still in `TEST_PLANNING`. Profiling showed the timeout was not Chromium startup: five serial planning calls could consume the budget, and Data Planner added two more 60-second timeout attempts for work that was deterministically unnecessary.

Root-cause classification: **PIPELINE_GLOBAL_TIMEOUT + RETRY_AMPLIFICATION**.

Observed profile: fixture preflight 6–20 ms; Requirement Builder 8–77 s; Test Planner 49–150 s; Data Planner 27–158 s before deterministic bypasses; Scenario 2/Chromium 3–30 s in successful runs. Cleanup succeeded in observed runs.

The harness ceiling was raised only to a bounded 420 seconds after this evidence. Provider requests remain individually bounded at 60 seconds with one configured attempt. No unbounded timeout was introduced.

## Minimal fixes applied

- Added stage progress/timing events and sanitized canary metrics.
- Avoided unnecessary AI enrichment when grounded state/database candidates cover every case.
- Skipped dependency analysis when fewer than two candidates exist.
- Preserved fail-closed classification for stateful existing data and identifiers.
- Tightened valid verification-type and expected-result planner instructions.
- Reset per-journey cleanup state for multi-TestCase execution.
- Reset Playwright `_started` on close so a reused executor can start a fresh browser.
- Preserved canonical assertion IDs so evidence links to verification needs.

## Real canary evidence

The canary reached the complete runtime path in successful partial runs:

`Specification/SemanticIR → Requirement Builder → real DeepSeek Test Planner → Test Data Planner → TestExecutionOrchestrator → automatic browser-discovery binding → real Chromium → Journey → Phase 2E UI/API verification → cleanup → Scenario3Result`.

Observed: real DeepSeek planning and journey calls, real Chromium, automatic `runtime.order.item` binding, UI/API evidence, cleanup success, and zero orphan evidence after the assertion-ID fix.

No single final run after all fixes produced `Scenario3Result = PASS` with every generated case complete. The latest bounded run reached Scenario 2, but DeepSeek generated three cases; two passed and one remained `BLOCKED` because its generated journey did not produce an assertion. Other runs exposed provider timeout or extra generated cases. This is semantic planning/output instability, not the original timeout, and prevents truthful final acceptance.

Latest representative result: `BLOCKED` (`2 passed, 1 blocked`), cleanup failures `0`, orphan evidence `0`, Chromium lifecycle clean.

## Timeout/budget ownership

| Layer | Bound | Owner |
|---|---:|---|
| Acceptance test | 420 s | canary harness |
| DeepSeek request | 60 s | AI Provider |
| DeepSeek attempts | 1 configured attempt | provider configuration |
| Journey decisions/calls/observations | 10 / 20 / 20 | Journey policy |
| Verification | existing bounded policy | Phase 2E |
| Cleanup | lifecycle owner | Scenario 2 |

No uncontrolled retry amplification remains in the exercised path.

## Trace and safety

The canonical trace contains source, requirement, scenario, TestCase, data need/item, expected result, verification need, evidence, and execution result nodes. Evidence orphaning was fixed by preserving `ASSERT-0001` across the Journey adapter.

```text
manual TestDataItems: 0
manual RuntimeBindings: 0
generated selectors: 0
planner selectors: 0
invented SQL: 0
invented endpoints: 0
capability escalation: 0
verification mutations: 0
production mutations: 0
raw secrets in AI/artifacts: 0
orphan evidence in latest run: 0
orphan resources: 0
lifecycle leaks: 0
```

## Regression evidence

- Test Planner bridge: 4 passed.
- Test Data Planner focused regressions: 97 passed.
- Agentic orchestrated journey/verification: 4 passed.
- E2E deterministic Scenario 3 tests: 3 passed; real canary skipped without opt-in.
- Typecheck/build: PASS for affected packages.
- Changed-scope lint: PASS with existing warnings only.
- Full Test Planner suite: 101 passed, 3 pre-existing checkpoint-resume failures (`FakeAIProvider: no more responses in queue`); focused Scenario 3 bridge tests pass.

## Remaining blocker

`SCENARIO_3_BLOCKER`: real DeepSeek-generated plans are not yet stable enough for one bounded run to produce a complete PASS. The platform correctly refuses to convert partially evidenced generated coverage into PASS.

## Deferred

- mSale real-environment validation
- large real specification corpus
- broader provider/model matrix
- durable cross-process resume

## Final

`SCENARIO 3 = NOT ACCEPTED`
