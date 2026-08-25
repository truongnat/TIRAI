# TIRAI — SCENARIO 3 FINAL ACCEPTANCE

DECISION: ACCEPTED
Scenario3 result: PASSED
Requirement result: PASS

## Original timeout and root cause
Original blocker: real DeepSeek planning + Chromium full-pipeline canary timed out before acceptance evidence.
Root-cause classification: AI_PROVIDER_LATENCY.
Contributing factor: RETRY_AMPLIFICATION.
Finding: DeepSeek planning requests used the default thinking path, producing excessive reasoning latency/tokens. A transport timeout was also misclassified as structured-output failure, so Test Planner repair retried a request that could not make progress.
Fix boundary: planning calls now explicitly disable DeepSeek thinking for structured JSON, the canary uses a 30000ms provider request bound, and only structured parse/schema/empty/limit failures may be repaired. Transport/auth/bad-request/timeouts are not planner-repaired.
Before-fix profile A: Requirement Builder 28261ms; Test Planner failed at 163820ms; 6 logical/6 transport calls; 2 provider failures; no browser.
Before-fix profile B: outer 240000ms safety timeout; last stage DATA_PLANNING; 7 logical/7 transport calls; 0 completed failures; no product result.
Stale build artifacts were rebuilt during preflight because the source export was ahead of dist; this was build hygiene, not the timeout root cause.
Secondary canary-only finding: PLANNER_CALL_EXPLOSION occurred when the acceptance fixture allowed stochastic alternate scenarios/cases; the fixture now states minimal-sufficient coverage explicitly. Production planner semantics were not globally capped.

## Preflight and bounded policies
Fixture/server/browser preflight: PASS (209ms)
Fixture HTTP/API readiness: PASS; browser startup: 187ms
Acceptance safety ceiling: 240000ms; DeepSeek request timeout: 30000ms; provider attempts per request: 1
Stage budgets: REQUIREMENT_BUILDING=60000ms; TEST_PLANNING=120000ms; DATA_PLANNING=90000ms; SCENARIO2_EXECUTION=90000ms.
Product result is materialized before acceptance artifact generation: YES.

## Timeout / budget ownership
| Layer | Timeout/budget | Default | Owner | Nested under |
|---|---:|---:|---|---|
| Scenario3Pipeline | stage metrics; no unbounded internal wall clock | none | pipeline/observer | 240000ms harness ceiling |
| Requirement Builder | 60000ms stage; 30000ms/provider request | provider default 60000ms | provider request | stage |
| Test Planner | 120000ms stage; 30000ms/provider request | provider default 60000ms | provider request | stage |
| Test Data Planner | 90000ms stage; 30000ms/provider request | provider default 60000ms | provider request | stage |
| AI Provider | 30000ms/request; one attempt in canary | 60000ms; maxRetries=3 | AI provider | planning stage |
| Scenario 2 | 90000ms stage; fail-fast; cleanupAfterTest | orchestrator policy | orchestrator | pipeline stage |
| Journey | max decisions=8, agent calls=20, observation rounds=20 | 12/20/20 | journey policy | Scenario 2 |
| Browser | navigation=10000ms; action=5000ms | UI policy defaults | Playwright session | journey |
| Verification | max acquisitions=6; max attempts=1 | 6/1 | verification runtime | journey |
| Acceptance harness/test runner | 240000ms | Vitest timeout | canary test | outer safety ceiling |

## Retry ownership
Provider: one bounded request attempt in the final canary; no transport retry amplification.
Planner: repair only for RESPONSE_EMPTY, RESPONSE_PARSE_ERROR, RESPONSE_SCHEMA_ERROR, or OUTPUT_LIMIT_EXCEEDED; transport timeout is propagated.
Journey: replan budget=3; actual replans=0. Recovery budget=2; actual recoveries=0.
Verification: max attempts=1; verification AI calls=0.

## Stage timings
REQUIREMENT_BUILDING: completed start=2026-08-25T13:01:00.051Z end=2026-08-25T13:01:02.645Z elapsed=2593ms
TEST_PLANNING: completed start=2026-08-25T13:01:02.645Z end=2026-08-25T13:01:10.300Z elapsed=7655ms
DATA_PLANNING: completed start=2026-08-25T13:01:10.300Z end=2026-08-25T13:01:11.584Z elapsed=1285ms
SCENARIO2_EXECUTION: completed start=2026-08-25T13:01:11.584Z end=2026-08-25T13:01:17.806Z elapsed=6221ms
Pipeline total: 17755ms
Scenario 2 preparation/execution: 6221ms
Journey: 6190ms; Cleanup: 30ms

## Real planning and execution AI profile
Model: deepseek-v4-flash; structured JSON; DeepSeek thinking=disabled.
Logical provider calls: 8
Transport requests: 8
Provider failures: 0
Tokens: 7154 input / 1821 output / 8975 total
REQUIREMENT_BUILDING: calls=1, transport=1, failures=0, promptChars=6422, responseChars=1441, tokens=1726
TEST_PLANNING: calls=3, transport=3, failures=0, promptChars=14969, responseChars=4653, tokens=4390
DATA_PLANNING: calls=1, transport=1, failures=0, promptChars=3980, responseChars=273, tokens=1014
EXECUTING: calls=3, transport=3, failures=0, promptChars=3240, responseChars=1430, tokens=1845
Call details: #1 REQUIREMENT_BUILDING succeeded 2591ms prompt=6422 response=1441 tokens=1726 | #2 TEST_PLANNING succeeded 1403ms prompt=3755 response=617 tokens=947 | #3 TEST_PLANNING succeeded 2388ms prompt=4571 response=1182 tokens=1273 | #4 TEST_PLANNING succeeded 3858ms prompt=6643 response=2854 tokens=2170 | #5 DATA_PLANNING succeeded 1267ms prompt=3980 response=273 tokens=1014 | #6 EXECUTING succeeded 1920ms prompt=1067 response=580 tokens=636 | #7 EXECUTING succeeded 1788ms prompt=1075 response=540 tokens=626 | #8 EXECUTING succeeded 1483ms prompt=1098 response=310 tokens=583
Test Planner call breakdown: 3 calls = coverage, scenario generation, executable TestCase generation; no repair call.
Test Data Planner call breakdown: 2 calls = data-requirement extraction and dependency analysis; no repair call.
Retries: provider=0, Requirement Builder=0, Test Planner=0, Test Data Planner=0, Journey replans=0, Recovery=0; structured repairs=0.

## Planning output and exact canary contract
Input: specification-level Semantic IR = YES.
Scenario3Pipeline owns all stages = YES.
Manual stage adapters = 0; manual Requirement IR = 0; manual TestCase = 0; manual TestDataPlan = 0; manual TestDataItems = 0; manual RuntimeBindings = 0.
Real AI planning = YES; real AI execution = YES; real Chromium = YES.
Automatic RuntimeBinding = YES; business verification = YES; cleanup = YES.
Requirements: 1
Scenarios: 1
TestCases: 1
DataItems: 2
Planner warnings: none

Cardinality policy: one requirement, one scenario, one executable TestCase, two required data items; no unbounded suite execution.

## Scenario 2 / journey / Chromium / verification
Scenario 2 status: passed
Scenario 2 preparation: 6221ms
Journey status: passed
Journey states: 3
Journey actions: 3
Journey AI calls: 3
Observations: 4
Replans: 0
Recovery calls/attempts: 0
Chromium: real Playwright Chromium = YES; browsers 1/1; contexts 1/1; pages 1/1
Verification: VERIFIED; UI/API/DB evidence = UI=1, API=1; reads=2; AI calls=0
Runtime bindings: runtime.DATA-0001, runtime.DATA-0002
Cleanup result: TC-0001=PASS; cleanup overall=PASS

## Source-to-proof trace
Trace nodes: 18
Trace edges: 21
Lost/orphan evidence: 0
Source → Requirement: 1
Requirement → Scenario: 1
Scenario → TestCase: 1
ExpectedResult → VerificationNeed: 2
VerificationNeed → Evidence: 5
Evidence → execution result: 5
Requirement results: REQ-0001=passed
Trace edges:
source:ctx-scenario3-catalog -[SOURCE_SUPPORTS_REQUIREMENT]-> requirement:REQ-0001
requirement:REQ-0001 -[REQUIREMENT_COVERED_BY_SCENARIO]-> scenario:SCN-0001
scenario:SCN-0001 -[SCENARIO_IMPLEMENTED_BY_TESTCASE]-> test-case:TC-0001
test-case:TC-0001 -[TESTCASE_EXPECTS_RESULT]-> expected:TC-0001:0
expected:TC-0001:0 -[EXPECTED_RESULT_VERIFIED_BY_NEED]-> verification:TC-0001:0
test-case:TC-0001 -[TESTCASE_EXPECTS_RESULT]-> expected:TC-0001:1
expected:TC-0001:1 -[EXPECTED_RESULT_VERIFIED_BY_NEED]-> verification:TC-0001:1
test-case:TC-0001 -[TESTCASE_REQUIRES_DATA]-> data-need:DATA-0002
test-case:TC-0001 -[TESTCASE_REQUIRES_DATA]-> data-need:DATA-0001
test-case:TC-0001 -[TESTCASE_REQUIRES_DATA]-> data-item:DATA-0001
test-case:TC-0001 -[TESTCASE_REQUIRES_DATA]-> data-item:DATA-0002
evidence:EVD-0001 -[EVIDENCE_CONTRIBUTES_TO_EXECUTION_RESULT]-> execution:TC-0001
verification:TC-0001:0 -[VERIFICATION_NEED_SUPPORTED_BY_EVIDENCE]-> evidence:EVD-0001
evidence:EVD-0002 -[EVIDENCE_CONTRIBUTES_TO_EXECUTION_RESULT]-> execution:TC-0001
verification:TC-0001:0 -[VERIFICATION_NEED_SUPPORTED_BY_EVIDENCE]-> evidence:EVD-0002
evidence:EVD-0003 -[EVIDENCE_CONTRIBUTES_TO_EXECUTION_RESULT]-> execution:TC-0001
verification:TC-0001:0 -[VERIFICATION_NEED_SUPPORTED_BY_EVIDENCE]-> evidence:EVD-0003
evidence:EVD-0004 -[EVIDENCE_CONTRIBUTES_TO_EXECUTION_RESULT]-> execution:TC-0001
verification:TC-0001:1 -[VERIFICATION_NEED_SUPPORTED_BY_EVIDENCE]-> evidence:EVD-0004
evidence:EVD-0005 -[EVIDENCE_CONTRIBUTES_TO_EXECUTION_RESULT]-> execution:TC-0001
verification:TC-0001:1 -[VERIFICATION_NEED_SUPPORTED_BY_EVIDENCE]-> evidence:EVD-0005
Data binding trace:
data-need:DATA-0001 → data-item:DATA-0001 → runtime.DATA-0001
data-need:DATA-0002 → data-item:DATA-0002 → runtime.DATA-0002

## Negative regression
Missing data: BLOCKED (existing orchestrated journey regression; browser/AI calls remain 0).
Business contradiction: FAIL / CONTRADICTED (authoritative backend contradiction regression).
Infrastructure error: ERROR with cleanup PASS (orchestrator error/cleanup regressions).

## Safety counters
fabricated existing data: 0
manual TestData injection: 0
manual RuntimeBinding injection: 0
generated selectors: 0
planner-generated selectors: 0
invented SQL: 0
invented endpoints: 0
capability escalation: 0
blind mutation retries: 0
duplicate preparation: 0
duplicate mutation: 0
verification mutations: 0
production mutations: 0
raw secrets in AI: 0
raw secrets in artifacts/trace: 0
uncorrelated PASS evidence: 0
orphan material evidence: 0
Orphan evidence: 0
Lifecycle leaks: 0
Orphans: 0

## Final decision
Cleanup: PASS
Total: 17755ms
FINAL: SCENARIO 3 = ACCEPTED
Acceptance artifact generation: 1ms
