# TIRAI — PHASE 4A FINAL ACCEPTANCE

DECISION: FROZEN
HEAD: 7388e74 + Phase 4A changes

## Architecture
Excel / Markdown → SourceConnector → CanonicalSourceDocument → CanonicalContextChunk → semantic-analyzer → Requirement Builder → Scenario3Pipeline → Scenario 2 → business proof.
Both canaries used the same `runScenario3FromSource` composition boundary. Manual Semantic IR, Requirement IR, TestCase, TestDataPlan, TestDataItems, and RuntimeBindings: 0.

## Canonical contract and security
SourceDescriptor, SourceRevision, SourceLocation, SourceArtifact, CanonicalSourceDocument, CanonicalContextChunk, and read-only SourceConnector are implemented in `source-ingestion`.
Source identity is stable per resolved local source; revision and artifact/context IDs are SHA-256-derived. Source content is DATA and raw connector credentials are not model fields or allowlisted metadata.
Unknown source extensions fail closed. Legacy `intelligent/excel/analyzer` was not used or modified.

## Real source-to-proof canaries
Preflight: fixture reachable = YES; API reachable = YES; Chromium launch = YES; elapsed=246ms; browser startup=223ms.
### Excel
input: real Excel fixture = YES
sourceId: src_cac9537715e7c03daab61067
revisionId: rev_7f28b8e3201a1e7077d971ec
ingestion: 33269ms; artifacts=2; contexts=1
Semantic Analyzer: AI calls=2; tokens=7164
Requirement Builder: 4760ms (completed)
Test Planner: 7151ms (completed); scenarios=1; TestCases=1
Test Data Planner: 1071ms (completed); data items=2
Scenario 2: 2018ms (completed); status=passed
Journey: status=passed; AI calls=1; observations=2; actions=1; replans=0
Chromium: real Playwright = YES; verification=VERIFIED; cleanup=PASS
Requirement result: REQ-0001=passed, REQ-0002=passed
Trace: source→requirement=2; revision/artifact/context lineage=1/1/1; context→requirement=2; orphan evidence=0
Total: 33269ms

### Markdown
input: local Markdown fixture = YES
sourceId: src_8d88d9d6202436bf9706662e
revisionId: rev_34bd80fe661bae2725b8ce64
ingestion: 37835ms; artifacts=3; contexts=1
Semantic Analyzer: AI calls=2; tokens=6906
Requirement Builder: 7851ms (completed)
Test Planner: 8644ms (completed); scenarios=1; TestCases=1
Test Data Planner: 1ms (completed); data items=1
Scenario 2: 4559ms (completed); status=passed
Journey: status=passed; AI calls=3; observations=4; actions=3; replans=0
Chromium: real Playwright = YES; verification=VERIFIED; cleanup=PASS
Requirement result: REQ-0001=passed, REQ-0002=passed, REQ-0003=passed, REQ-0004=passed, REQ-0005=passed
Trace: source→requirement=5; revision/artifact/context lineage=1/1/1; context→requirement=5; orphan evidence=0
Total: 37835ms

## AI profile
Model: deepseek-v4-flash; structured JSON; thinking disabled.
calls=19; transport=19; failures=0; tokens=22447/12715/35162
SOURCE_INGESTION: calls=4; transport=4; failures=0; promptChars=28990; tokens=14070
REQUIREMENT_BUILDING: calls=4; transport=4; failures=0; promptChars=23438; tokens=7537
TEST_PLANNING: calls=6; transport=6; failures=0; promptChars=33299; tokens=10113
DATA_PLANNING: calls=1; transport=1; failures=0; promptChars=3958; tokens=1026
JOURNEY: calls=4; transport=4; failures=0; promptChars=4315; tokens=2416

## Trace and safety
Trace: Source → SourceRevision → SourceArtifact → SemanticContext → Requirement → Scenario → TestCase → ExpectedResult → VerificationNeed → Evidence → ExecutionResult.
lost provenance = 0; orphan source nodes = 0; orphan semantic contexts = 0; orphan material evidence = 0; fabricated source metadata = 0; fake Excel provenance for Markdown = 0.
fabricated existing data = 0; manual injections = 0; generated selectors = 0; invented SQL = 0; invented endpoints = 0; capability escalation = 0; production mutations = 0; raw secrets in AI/artifacts = 0; lifecycle leaks = 0; orphans = 0.

## Regression and freeze gate
Deterministic source-ingestion, semantic canonical boundary, Requirement Builder, Scenario 3 trace, existing Excel extractor, and accepted downstream suites are green before the real canary.
Browser counters: browsers 2/2; contexts 2/2; pages 2/2; lifecycle leaks=0.
FINAL: PHASE 4A = FROZEN
