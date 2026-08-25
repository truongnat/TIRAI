# TIRAI — SCENARIO 2 FINAL ACCEPTANCE AUDIT

Decision: NOT ACCEPTED

HEAD: 9557685
Branch: main

## Closed-loop control flow observed

The normal platform path is:

`TestExecutionOrchestrator.run` → executor registry selection → executor `execute` → JourneyAgent (when a preconfigured `JourneyTestExecutor` is registered) → browser observation/grounding → recovery → Phase 2E verification → executor cleanup → orchestrator result.

The JourneyAgent itself runs:

`DataNeedCoordinator.prepare(testDataItems)` → RuntimeBindings → browser journey → source hint resolution/confirmation → recovery → `verifyCrossLayer` → cleanup.

This is coherent for a manually pre-wired executor, but the normal orchestrator does not supply the Phase 2B `TestDataItem[]`/data-plan to the JourneyTestExecutor. `TestCase` has `dataNeeds`, while `JourneyAgent` reads only constructor option `testDataItems`. The orchestrator's own preparation phase currently records a zero-operation summary and does not bridge the data plan into the executor. Therefore the full 2B → 2C → 2D → 2E → cleanup lifecycle is not reachable from a semantic TestCase plus runtime capabilities alone.

## SCENARIO_2_BLOCKERS

### BLOCKER 1 — Phase 2B is not connected to normal journey orchestration

Evidence:

- `TestCase.dataNeeds` is defined in the canonical Test Planner IR.
- `JourneyAgent.execute` calls `prepare(this.testDataItems, ...)`.
- `JourneyTestExecutor` receives `testDataItems` only through constructor options.
- `TestExecutionOrchestrator` builds context but does not carry data items/data-plan into that executor.
- Repository search found no production bridge from `dataPlan`/`requiredDataItemIds` to `JourneyTestExecutor`.

Impact: a normal orchestrated journey can execute without resolving a required existing entity. The accepted Phase 2B safety contract is individually tested, but not enforced at the Scenario 2 platform boundary.

### BLOCKER 2 — all-blocked orchestrator run is reported as passed

Reproduction against current built orchestrator:

```json
{"runStatus":"passed","testStatus":"blocked","blocked":1}
```

`TestExecutionOrchestrator.run` determines run status from errors/failures/passed counts and has no blocked-only branch. This violates canonical `BLOCKED` semantics at the platform result boundary.

### BLOCKER 3 — executor exception skips cleanup

Reproduction with a registered executor whose `execute()` throws:

```json
{"status":"error","cleanupAttempted":0,"cleaned":0}
```

The orchestrator catch path sets `ERROR` and exits the test lifecycle without invoking `executor.cleanup()`. This violates the closed-loop requirement that cleanup runs after relevant `ERROR` paths.

## Canaries and integration evidence

The existing phase-level canaries remain green, but they do not close the blockers above:

- Phase 2F gray-box canary: PASS; DeepSeek `deepseek-v4-flash`, real Chromium, 4 AI calls, 2,033 input / 399 output / 2,432 total tokens, 3 semantic states, 2 transitions, stale recovery, UI+API verification.
- Phase 2C orchestrator journey: PASS.
- Phase 2D recovery suite: PASS, including session recovery, popup loss, stale recovery, and reconciliation.
- Phase 2E contradiction acceptance: PASS; UI success with wrong backend state becomes `failed`.
- Phase 2F stale-source acceptance: PASS; stale hint rejected and runtime grounding continues.

These are not a full Scenario 2 happy/recovery canary because the real canary has no orchestrator-provided Phase 2B data plan/runtime data item set; it uses an executor configured directly with its own options.

Required full canaries therefore remain unproven:

- Full happy closed loop with normal data-plan-to-executor binding: NOT PROVEN.
- Full recovery closed loop after real Phase 2B preparation: NOT PROVEN.
- Missing-capability closed loop before browser/AI action: NOT PROVEN through the normal orchestrator data boundary.
- Error cleanup closed loop: FAILS as reproduced above.

## Phase integration audit

- 2B → 2C: PARTIAL. Works inside JourneyAgent when `testDataItems` are pre-wired; missing normal platform bridge.
- 2C → 2D: PASS in accepted recovery tests.
- 2D → 2E: PASS in stale/recovery plus verification tests.
- 2F → runtime: PASS; source optional, runtime confirmation authoritative, no selectors.
- 2F → 2E: advisory only and capability-safe; no escalation observed.
- Verification → cleanup: PASS inside JourneyAgent; final verification is performed before `JourneyAgent.cleanup()`.
- Cleanup after executor-thrown ERROR: FAIL at orchestrator boundary.

## Safety counters observed

Existing phase acceptance counters remain zero for fabricated data, generated/source-direct selectors, stale executions, blind mutation retries, duplicate mutations, invented SQL/endpoints, capability escalation, verification mutations, production mutations, unauthorized external actions, raw secrets, orphans, and lifecycle leaks. However, Scenario 2 cannot claim these counters for the missing normal Phase 2B bridge and skipped-error-cleanup path until the blockers are fixed and rerun end-to-end.

## Regression

- Agentic: 151 passed, 2 skipped.
- Planner: 144 passed.
- Resolver: 111 passed.
- DB: 112 passed, 1 skipped.
- API: 148 passed.
- UI: 176 passed.
- Orchestrator: 144 passed.
- Execution Engine: 153 passed on isolated rerun; one parallel run exposed a timestamp-sensitive determinism flake, then the isolated suite passed.
- AI Provider: 94 passed, 2 skipped.
- Project Adapter: 157 passed.
- Agentic typecheck: PASS.
- Agentic build: PASS.
- Agentic changed-scope lint: PASS.

No source changes were made during this audit. The two known unrelated semantic-analyzer workspace lint errors remain out of scope.

## IMPORTANT

- Execution Engine determinism test is timing-sensitive under parallel workspace load; isolated rerun passed. This is not the primary Scenario 2 blocker but should be stabilized separately.
- Existing phase canaries are strong evidence for individual contracts, not sufficient evidence for the missing cross-phase data bridge.

## DEFERRED

- mSale real-environment validation.
- Full browser-process resurrection.
- Durable cross-process resume.
- Broader provider/runtime matrix.

## Final decision

SCENARIO 2 = NOT ACCEPTED

Minimal next fixes required before acceptance:

1. Bridge canonical TestCase/data-plan runtime data into the normal JourneyTestExecutor path without requiring manual internal wiring.
2. Preserve `BLOCKED` at the orchestrator run-status boundary.
3. Guarantee executor cleanup on thrown execution errors, with regression coverage.
