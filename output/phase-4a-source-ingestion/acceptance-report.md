# TIRAI — PHASE 4A SOURCE INGESTION ACCEPTANCE

DECISION: NOT FROZEN
HEAD: 7388e74

## Architecture
Excel / Markdown → SourceConnector → CanonicalSourceDocument → CanonicalContextChunk → semantic-analyzer → Requirement Builder → Scenario3Pipeline → Scenario 2.

## Implemented deterministic evidence
Canonical contracts: SourceDescriptor, SourceRevision, SourceLocation, SourceArtifact, CanonicalSourceDocument, CanonicalContextChunk, read-only SourceConnector.
Excel: existing workbook-inspector, cell-layout-extractor, and excel/context-builder reused; sheet/range/cell are mapped into generic location segments.
Markdown: deterministic document/heading/content-block/line-range hierarchy with parent artifact links.
Identity: SHA-256 source content hashes and stable source/revision/artifact/context IDs; stale revision validation fails closed.
Security: source text remains DATA; unsafe metadata is dropped; raw connector credentials are not canonical model fields.
Registry: Excel and Markdown selection is deterministic; unsupported extensions fail closed.
Canonical Semantic Analyzer and Requirement Builder preserve sourceId/revisionId/artifactId/location. Scenario 3 trace has source→revision→artifact→context lineage.
Frozen-module audit: Scenario 2, Agentic Journey, recovery, verification, RuntimeBindings, execution engines, ProjectAdapter, AI Provider policy, and Excel extractor internals were not modified. Scenario 3 changes are trace metadata only plus the thin source composition boundary outside planning/execution.
Deterministic tests: source-ingestion 4 passed; semantic-analyzer 119 passed, 1 skipped; requirement-builder 53 passed, 1 skipped; Scenario 3 bridge 4 passed.
Relevant downstream regression suites, typecheck-all, and build-all passed. Changed-scope lint passed. Full workspace test run has one unrelated historical performance-benchmark failure: PEAK_RSS_BUDGET_EXCEEDED warning was not emitted.
Existing semantic-analyzer package lint retains two historical unused-variable errors in analysis/consolidator.ts; no new errors were introduced in the changed scope.

## Real canary blocker
Blocker: DEEPSEEK_API_KEY is not configured in this environment; real AI + Chromium canaries were not started.
Therefore Excel source-to-proof = NOT ESTABLISHED and Markdown source-to-proof = NOT ESTABLISHED.
Required next action: provide the accepted DeepSeek credential through the environment and rerun RUN_PHASE4A_REAL_CANARY=true. No source-specific downstream branch is used.

## Safety counters
manual Semantic IR / Requirement IR / TestCase / TestDataPlan / RuntimeBinding injection = 0 in the canary harness; fake Excel provenance for Markdown = 0; raw secrets in AI/artifacts = 0; source-specific Scenario 3/Scenario 2 branches = 0.

FINAL: PHASE 4A = NOT FROZEN
