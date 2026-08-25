# TIRAI — SCENARIO 3 SPEC-TO-EXECUTION BRIDGE

Decision: ACCEPTED

Baseline: `cbf0a1e`
Audit date: 2026-08-25

## Pipeline

Specification → Requirement IR → Scenario/TestCase IR → TestDataPlan →
Scenario 2 execution adapter → evidence/result.

The new `Scenario3Pipeline` keeps stage results in memory and composes the
Requirement, Test Planner, Test Data Planner, and normal execution seams. It
does not require consumers to copy artifact directories between CLIs. Existing
CLIs remain available.

## Closed blockers

- Data needs are inherited deterministically from applicable requirements and
  scenarios into TestCases, then into the data plan. Requirement-owned needs
  retain requirement/context provenance.
- Coverage/scenario/test-case prompts now carry preconditions, constraints,
  expected behaviors, outcomes, and data needs.
- `ExpectedResult.verificationIntent` expresses business semantics such as
  persisted state, entity existence/absence, equality, and deltas without
  embedding SQL or endpoints.
- Parent provenance is merged deterministically; AI provenance cannot replace
  it. Data-plan requirement validation uses the actual TestCase requirement ID
  set.
- Empty steps, blank actions, invalid ordering, and unsupported automation are
  surfaced as planning warnings before Scenario 2 execution.
- Requirement coverage is based on an executable TestCase, not merely a
  generated Scenario; planner warnings are retained in `TestPlanIR`.
- Programmatic `Scenario3Pipeline` blocks planning defects before data planning
  or execution and maps stage/execution failures to explicit status outcomes.

## Deterministic acceptance

- Requirement data need → TestCase → TestDataPlan trace: PASS.
- Full context prompt propagation: PASS.
- Persisted-business-state ExpectedResult intent: PASS.
- Invalid verification type warning: PASS.
- Non-executable TestCase rejection: PASS.
- In-memory pipeline happy path: PASS.
- In-memory pipeline planning blocker: PASS; data planning and execution calls
  were zero.

Focused/new tests: Test Planner 103 passed; Test Data Planner 144 passed;
Requirement Builder 53 passed, 1 skipped; Scenario 3 coordinator 2 passed;
Scenario 3 bridge 3 passed.

## Runtime evidence

The existing opt-in DeepSeek + real Chromium black-box canary passed in the
company environment (1 real AI/Chromium acceptance). The previously accepted
Scenario 2 runtime canaries and the normal e2e-runner real Chromium acceptance
remain green. The three-layer producer bridge itself is covered by deterministic
in-memory stage integration; no company mutation was performed.

## Safety counters

fabricated existing data: 0
generated/source selectors: 0
invented SQL/endpoints: 0
capability escalation: 0
production mutation: 0
verification mutation: 0
duplicate preparation/mutation: 0
secret leakage in new bridge/artifact: 0
orphans/lifecycle leaks in accepted runtime: 0
lost required needs in focused bridge: 0
lost provenance in focused bridge: 0
non-executable TestCases sent by coordinator: 0
manual artifact handoffs required by coordinator: 0

## Verification

Typecheck-all: PASS.
Changed-scope lint: PASS with existing warnings only; no errors.
Build: PASS for Requirement Builder, Test Planner, Test Data Planner, and
e2e-runner.

Relevant package regressions passed, including Scenario 2 orchestrator,
execution engine, API, DB, UI, project adapter, and agentic suites. One
aggregate popup assertion was timing-sensitive and passed on focused rerun.
The AI-provider missing-key test is environment-sensitive and fails when the
protected company key is present; no provider code was changed.

## Deferred / non-blocking

- mSale real-environment validation.
- Full browser-process resurrection and durable cross-process resume.
- Broader in-memory refactoring of legacy disk-oriented CLI stage APIs; the
  programmatic coordinator removes manual artifact handoff at the integration
  boundary without changing those CLI contracts.

## Final

The audited seven producer-side blockers are closed with deterministic
propagation/validation and a programmatic composition seam. Scenario 2 remains
the execution authority.

`SCENARIO 3 BRIDGE = ACCEPTED`
