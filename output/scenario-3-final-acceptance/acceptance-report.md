# TIRAI — SCENARIO 3 FINAL END-TO-END ACCEPTANCE

Decision: **NOT ACCEPTED**

HEAD at audit start: `2939aea`

## Native pipeline closure implemented

The default `Scenario3Pipeline` now owns the in-memory path:

`SemanticIR → Requirement Builder → Test Planner → Test Data Planner → TestExecutionOrchestrator → Scenario3Result`.

The planner packages retain their disk-based CLI APIs, while exposing in-memory cores. The normal coordinator no longer requires stage adapters or an execution adapter. Orchestrator construction is owned by the pipeline when `orchestratorOptions` are supplied; an orchestrator instance remains a test-only injection seam.

## Canonical trace

`Scenario3Result.trace` exposes source, requirement, scenario, test-case, data-need, data-item, expected-result, verification-need, evidence, and execution-result nodes with explicit edges. Evidence is linked to assertion-derived verification nodes and orphan material evidence is reported. `requirementResults` aggregates execution status without boolean reduction.

## Deterministic proof

- Native default composition test: PASS.
- Native source-to-proof trace test: PASS.
- Legacy bridge regression: PASS (compatibility seam only).
- Requirement Builder: 53 passed, 1 skipped.
- Test Planner bridge: 3 passed.
- Test Data Planner: 144 passed.
- E2E Runner: 226 passed.
- Test Execution Orchestrator: 147 passed.
- Typecheck: PASS.
- Build: PASS.
- Changed-scope lint: PASS with pre-existing warnings only.

## Real canary

An opt-in canary was added and executed from specification-level input using the canonical provider, planner stages, orchestrator, Journey executor, and real Chromium. The run exceeded the bounded command window and was terminated without producing an acceptance report. Therefore the required single-run proof of real AI planning plus real Chromium execution is **not established**.

## Remaining blocker

`SCENARIO_3_BLOCKER`: the required real end-to-end canary did not complete. The deterministic implementation is not sufficient to claim the product-level acceptance requested by Scenario 3.1.

## Safety

No application-specific selectors, SQL, endpoints, production mutations, or secret values were added. Existing deterministic tests remain green. No acceptance decision is inferred from the timed-out canary.

## Deferred

- mSale real-environment validation
- large real specification corpus
- broader provider matrix
- durable cross-process resume

## Final

`SCENARIO 3 = NOT ACCEPTED`
