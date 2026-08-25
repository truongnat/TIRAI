# TIRAI — PHASE 2F ACCEPTANCE

Decision: FROZEN

Baseline: 8dab075
Scope: optional source-assisted gray-box execution; Phase 2B–2E contracts unchanged.

## Architecture

Repository/project profile → `SourceIntelligenceProvider` → sanitized canonical source hints → bounded relevant-hint resolver → existing Journey Agent → runtime observation/grounding → Phase 2D recovery → Phase 2E verification → cleanup.

Source is advisory. Runtime observation and capability policy remain authoritative. The provider is optional; absent or failed source intelligence falls back to the existing black-box path.

## Source intelligence

The adapter reuses the existing `project-adapter` profile catalogs and converts route, screen, semantic action, API, entity, and persistence metadata into source hints. Locator values are intentionally excluded. Hints carry snapshot/provenance and confidence (`DECLARED`, `DERIVED`, `INFERRED`) plus lifecycle (`DISCOVERED`, `SUGGESTED`, `CONFIRMED`, `REJECTED`, `STALE`).

Relevant hints are bounded per observation. Stale/rejected hints cannot be confirmed or executed. Confirmed hints only select a currently observed semantic element; no source selector, XPath, DOM id, browser script, or static journey is executed.

## Runtime reconciliation and safety

- Source/provider unavailable: black-box fallback.
- Source/provider failure: degraded black-box execution, no test error solely from optional source failure.
- Runtime/source conflict: runtime wins; stale hints are rejected.
- API/DB hints: advisory only and still require existing API_READ/DATABASE_READ capability.
- Source-derived selectors: 0.
- Invented routes/endpoints/SQL: 0.
- Capability escalation: 0.
- Source secrets in intelligence, AI prompts, and artifacts: 0.

## Acceptance

Deterministic source-intelligence tests: 6 passed.
They cover optional fallback, semantic action confirmation, stale rejection, project-catalog conversion without locators, secret sanitization, and an orchestrated browser journey that rejects a stale action hint and continues from runtime reality.

Real gray-box canary:

- Provider/model: DeepSeek / `deepseek-v4-flash`.
- Execution path: `TestExecutionOrchestrator` → `JourneyTestExecutor`.
- Source: repository `project-adapter` sample profile loaded through `JsonProjectAdapter`, plus sanitized fixture semantic hints.
- AI: 4 calls; 2,033 input / 399 output / 2,432 total tokens.
- Browser: real Chromium; 5 observations, 3 unique semantic states, 2 route transitions, 4 actions.
- Source hints: 17 catalog-derived/fixture-relevant hints available in the run; 4 used; 5 confirmations across the bounded loop.
- Phase 2D: one controlled stale-action disruption detected and recovered.
- Phase 2E: UI + API read evidence, 2 acquisitions, 0 verification AI calls, result `VERIFIED`.
- Generated/source-direct selectors: 0; external actions: 0; lifecycle leaks: 0.
- Result: PASS.

Black-box vs gray-box comparison: the preceding black-box canary used 8 provider calls and approximately 5,586 total tokens for the same three-state fixture journey; the gray-box run used 4 provider calls and 2,432 total tokens while retaining the same multi-state runtime evidence and final verification. This is an optimization comparison, not a relaxation of evidence requirements.

Stale-source canary: a source action marked `STALE` was presented for a matching runtime state; it was rejected, no source action was executed, fresh runtime grounding completed the journey, and the result was PASS.

## Regressions

- Agentic: 151 passed, 2 skipped.
- Source-intelligence focused: 6 passed.
- Project adapter: 157 passed.
- Agentic typecheck: PASS.
- Agentic build: PASS.
- Changed-scope lint: PASS.
- Existing workspace-wide semantic-analyzer lint debt: 2 known pre-existing errors, unchanged and out of scope.

Phase 2B, 2C, 2D, and 2E acceptance suites remained green through the Agentic regression, including data safety, journey/popup/history, recovery/reconciliation, and cross-layer contradiction verification.

## Frozen-module audit

No Phase 2B/2C/2D/2E contract was changed. Changes are limited to the optional source-hint boundary, JourneyAgent integration, source metrics, tests, and canary reporting. Existing runtime grounding, capability enforcement, verification, recovery, cleanup, and secret boundaries remain the authoritative paths.

## Deferred

- mSale real-environment validation.
- Full browser-process resurrection and durable cross-process resume.
- Broader repository source scanning beyond the existing project-adapter catalogs.

These do not block the optional source-assisted runtime contract demonstrated here.

## Final

PHASE 2F = FROZEN
