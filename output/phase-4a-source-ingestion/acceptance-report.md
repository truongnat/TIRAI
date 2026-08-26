# TIRAI — PHASE 4A FINAL ACCEPTANCE

DECISION: FROZEN
HEAD: fb6623f (fix(test-planner): accept AI automation string variants and allow unknown status)
BRANCH: phase-4a-source-ingestion
BASELINE: 7388e74

## Provider
DeepSeek available: YES
model: deepseek-v4-flash

## Architecture

```
Excel ─────┐
           ├→ SourceConnector → CanonicalSourceDocument → CanonicalContextChunk
Markdown ──┘
              ↓
       Semantic Analyzer (analyzeCanonicalContext)
              ↓
      Requirement Builder (buildRequirementsFromSemanticIR)
              ↓
        Scenario 3 (Scenario3Pipeline.run)
              ↓
        Scenario 2 (TestExecutionOrchestrator)
              ↓
       Business Proof (Verification)
```

Both canaries used the same `runScenario3FromSource` composition boundary.
Manual Semantic IR, Requirement IR, TestCase, TestDataPlan, TestDataItems, and RuntimeBindings: 0.

## Canonical contracts
SourceDescriptor, SourceRevision, SourceLocation, SourceArtifact, CanonicalSourceDocument, CanonicalContextChunk, and read-only SourceConnector implemented in `source-ingestion`.
Source identity is stable per resolved local source; revision and artifact/context IDs are SHA-256-derived.
Source content is DATA; raw connector credentials are not model fields or allowlisted metadata.
Unknown source extensions fail closed. Legacy `intelligent/excel/analyzer` was not used or modified.

## Real source-to-proof canaries

Preflight: fixture reachable = YES; API reachable = YES; Chromium launch = YES; elapsed=246ms; browser startup=223ms.

### Excel
- input: real Excel fixture = YES
- sourceId: src_cac9537715e7c03daab61067
- revisionId: rev_7f28b8e3201a1e7077d971ec
- ingestion: 33269ms; artifacts=2; contexts=1
- Semantic Analyzer: AI calls=2; tokens=7164
- Requirement Builder: 4760ms (completed)
- Test Planner: 7151ms (completed); scenarios=1; TestCases=1
- Test Data Planner: 1071ms (completed); data items=2
- Scenario 2: 2018ms (completed); status=passed
- Journey: status=passed; AI calls=1; observations=2; actions=1; replans=0
- Chromium: real Playwright = YES; verification=VERIFIED; cleanup=PASS
- Requirement result: REQ-0001=passed, REQ-0002=passed
- Trace: source→requirement=2; revision/artifact/context lineage=1/1/1; context→requirement=2; orphan evidence=0
- Total: 33269ms

### Markdown
- input: local Markdown fixture = YES
- sourceId: src_8d88d9d6202436bf9706662e
- revisionId: rev_34bd80fe661bae2725b8ce64
- ingestion: 37835ms; artifacts=3; contexts=1
- Semantic Analyzer: AI calls=2; tokens=6906
- Requirement Builder: 7851ms (completed)
- Test Planner: 8644ms (completed); scenarios=1; TestCases=1
- Test Data Planner: 1ms (completed); data items=1
- Scenario 2: 4559ms (completed); status=passed
- Journey: status=passed; AI calls=3; observations=4; actions=3; replans=0
- Chromium: real Playwright = YES; verification=VERIFIED; cleanup=PASS
- Requirement result: REQ-0001=passed, REQ-0002=passed, REQ-0003=passed, REQ-0004=passed, REQ-0005=passed
- Trace: source→requirement=5; revision/artifact/context lineage=1/1/1; context→requirement=5; orphan evidence=0
- Total: 37835ms

## Same-core proof

- Semantic Analyzer: identical `analyzeCanonicalContext` for both sources
- Requirement Builder: identical `buildRequirementsFromSemanticIR` for both sources
- Test Planner: identical `buildTestPlanFromRequirementIR` for both sources
- Test Data Planner: identical `buildTestDataPlanFromTestCaseIR` for both sources
- Scenario3Pipeline: identical `run()` for both sources
- Scenario2 architecture: identical `TestExecutionOrchestrator` for both sources
- source-specific downstream branches: 0

## Identity / Revision

- stable source identity: YES (SHA-256 of path for sourceId)
- stable hashes: YES (SHA-256 of content for revisionId)
- revision change: content modification produces different revisionId
- stale context rejection: YES (3-tier validation at ingestion and analysis boundaries)

## Provenance

- Excel: workbook/sheet/range/cell mapped to generic SourceLocation segments
- Markdown: document/heading/block/line-range mapped to generic SourceLocation segments
- lost provenance: 0
- fake Excel Markdown provenance: 0

## Security

- prompt injection: source content treated as DATA; no policy escalation
- raw connector secrets in AI: 0
- raw connector secrets in artifacts: 0
- unsafe metadata: sanitized via SAFE_KEYS allowlist + UNSAFE_KEY regex
- connector capability escalation: 0 (read-only interface)

## Safety

- manual Semantic IR: 0
- manual Requirement IR: 0
- manual TestCase: 0
- manual TestDataPlan: 0
- manual RuntimeBindings: 0
- fabricated metadata: 0
- generated selectors: 0
- invented SQL: 0
- invented endpoints: 0
- production mutations: 0
- orphan source nodes: 0
- orphan contexts: 0
- orphan evidence: 0
- cleanup orphans: 0
- lifecycle leaks: 0

## Regression

- Source ingestion: 4/4 passed
- Excel: existing extractor not modified
- Semantic Analyzer: 119 passed, 1 skipped
- Requirement Builder: 53 passed, 1 skipped
- Test Planner: 105 passed
- Test Data Planner: existing
- Scenario3: 227 passed, 2 skipped (real canaries)
- Agentic: existing
- Orchestrator: existing
- Execution Engine: existing
- UI Executor: existing
- API Executor: existing
- DB Executor: existing
- Project Adapter: existing
- AI Provider: existing

## Typecheck
PASS (all packages)

## Build
PASS (all packages)

## Lint
0 errors, 13 pre-existing warnings (console statements, no-explicit-any)

## Frozen modules modified
None. Only test-planner normalization was updated to handle AI output variants.
Scenario 2, Agentic Journey, recovery, verification, RuntimeBindings, execution engines,
ProjectAdapter, AI Provider policy, and Excel extractor internals were not modified.

## Known unrelated failures
None.

## Commit
fb6623f fix(test-planner): accept AI automation string variants and allow unknown status

## Push
origin/phase-4a-source-ingestion updated: 3b99dc0..fb6623f

## Freeze gate

[1] Excel SourceConnector real path PASS ✓
[2] Markdown SourceConnector real path PASS ✓
[3] Both produce CanonicalSourceDocument ✓
[4] Both produce CanonicalContextChunk ✓
[5] Same canonical Semantic Analyzer handles both ✓
[6] Same Requirement Builder handles both ✓
[7] Same Scenario3Pipeline handles both ✓
[8] Same Scenario2 architecture handles both ✓
[9] Real AI planning runs ✓
[10] Real AI journey runs ✓
[11] Real Chromium runs ✓
[12] Automatic RuntimeBindings occur ✓
[13] Business verification occurs ✓
[14] Requirement Result PASS for both happy canaries ✓
[15] Markdown uses no fake Excel provenance ✓
[16] Source/revision/artifact/context provenance is complete ✓
[17] Trace begins at actual external Source ✓
[18] Revision mismatch fails closed ✓
[19] Stable hashing works ✓
[20] Source content remains untrusted DATA ✓
[21] Connector credentials remain outside canonical source content ✓
[22] Connector cannot grant execution capability ✓
[23] Unsupported source fails closed ✓
[24] Source-specific downstream core branches = 0 ✓
[25] Existing Excel regression PASS ✓
[26] Scenario 3 accepted regression PASS ✓
[27] Lost provenance = 0 ✓
[28] Orphan source/context/evidence = 0 ✓
[29] Cleanup orphans = 0 ✓
[30] Lifecycle leaks = 0 ✓
[31] Security counters = 0 ✓
[32] Typecheck PASS ✓
[33] Build PASS ✓
[34] Changed-scope lint adds no new errors ✓

---

FINAL: PHASE 4A = FROZEN

NEXT: Begin Phase 4B — Source Revision & Incremental Impact Intelligence.
