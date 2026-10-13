# Requirement Builder v1 — Final Report

> Historical implementation report. Provider/API measurements, test counts, and validation results below describe the report-era implementation only; they are not claims about current code or a live model-provider path.

---

## 2. Implementation Summary

### Architecture
- **Tool-only execution**: Current pipeline uses deterministic/local analysis; historical provider-era measurements below describe an earlier implementation and are not current execution guarantees.
- **Evidence-centric**: Every requirement traces back to semantic evidence (flows, rules, entities)
- **Deterministic output**: Sorted by provenance → type → statement, then assigned REQ-0001, REQ-0002, etc.

### Key Files
| File | Lines | Purpose |
|------|-------|---------|
| `src/models.ts` | 391 | All type definitions (RequirementIR, Requirement, candidates, etc.) |
| `src/builder.ts` | 640 | Main orchestrator with enrichment pipeline |
| `src/prompts/system.ts` | 93 | System prompt (REQUIREMENT_PROMPT_VERSION = '1.0') |
| `src/prompts/extraction.ts` | 183 | Evidence batch rendering for AI |
| `src/analysis/candidate-extractor.ts` | 226 | Per-batch AI extraction + normalization |
| `src/analysis/evidence-grouper.ts` | 130 | Bounded batch creation from Semantic IR |
| `src/analysis/consolidator.ts` | 178 | AI-assisted dedup + conflict detection |
| `src/merge/requirement-merger.ts` | 180 | Deterministic dedup (Jaccard + exact match) |
| `src/merge/conflict-detector.ts` | 192 | Required-vs-optional + inconsistent constraint detection |
| `src/validation/requirement-validator.ts` | 160 | Entity-like detection, atomicity, testability |

### File Count
- **Source files**: 20 TypeScript files in `src/`
- **Test files**: 5 test files in `tests/`
- **Tests**: Counts below are historical report data, not a statement of current test status.

---

## 3. Real Scenario Results

### Input
- **Feature**: User Authentication (login, registration, password reset, session management)
- **Semantic IR**: 4 sections, 5 entities, 4 flows, 10 rules, 5 relationships, 1 unresolved
- **Source contexts**: 2 (Authentication Spec, Security Requirements)

### Output
| Metric | Value |
|--------|-------|
| Requirements | 20 |
| Explicit | 12 (60%) |
| Derived | 8 (40%) |
| Conflicts | 0 |
| Unresolved | 1 (MFA/2FA) |
| Testable | 20 (100%) |
| Provenance Coverage | 1.0 (100%) |
| Low Confidence | 0 |
| Historical AI requests | 6 (not current runtime behavior) |
| Historical token usage | ~20,763 (not current runtime behavior) |

### Requirement Type Distribution
| Type | Count |
|------|-------|
| security | 8 |
| validation | 7 |
| business-rule | 4 |
| functional | 1 |
| state-transition | 1 |

Historical AI-enrichment results (not current runtime behavior):

---

## 4. Hallucination Review

### No Entity-as-Requirement Hallucinations
- No requirement is just "System shall have <entity name>"
- All requirements describe verifiable behaviors or constraints

### No Invented Behavior
- All requirements trace to semantic evidence (flows, rules)
- Derived requirements are clearly marked as `sourceNature: 'derived'`
- Confidence scores reflect evidence strength (0.9–1.0)

### Provenance Integrity
- 100% of requirements have valid provenance references
- All contextIds resolve to source document contexts

### Evidence ID Integrity
- All `relatedSemanticIds` reference valid Semantic IR objects
- AI-hallucinated prefixes (`flow-flow-0003`) automatically sanitized

---

## 5. Quality Review

### Testability
- **100% testable**: All 20 requirements have measurable criteria
- Statements contain verifiable obligations (numbers, conditions, actions)
- Examples: "at least 8 characters", "15 minutes after 5 consecutive failures", "expire after 1 hour"

### Confidence Distribution
- 0.99–1.0: 8 requirements (explicit rules with clear criteria)
- 0.93–0.98: 12 requirements (derived from flows with strong evidence)
- Below 0.9: 0 requirements

Historical provider-era candidate counts and consolidation results (not current runtime behavior).

---

## 6. Test Coverage

### Historical unit-test record (not current test status)
| Test File | Tests | Coverage |
|-----------|-------|----------|
| `loader.test.ts` | 8 | Input validation, structural checks (§64) |
| `extraction.test.ts` | 10 | Evidence batching, atomicity, normalization |
| `quality.test.ts` | 25 | Dedup, conflicts, provenance, testability, determinism, security |
| `builder.test.ts` | 7 | End-to-end pipeline, manifest, quality report, output files |

Historical integration-test record (not a current/live provider path):
| Test | Historical provider | Reported result |
|------|--------------------|-----------------|
| `groq-integration.test.ts` | Groq API (llama-3.3-70b) | PASS (4.8s) |

### Test Scenarios Covered (spec §65–§73)
- ✅ Valid input produces correct output
- ✅ Empty IR produces empty requirements
- ✅ Deterministic ordering (provenance → type → statement)
- ✅ Deterministic IDs (REQ-0001, REQ-0002, ...)
- ✅ Duplicate detection (exact + Jaccard)
- ✅ Conflict detection (required-vs-optional, inconsistent constraints)
- ✅ Provenance validation (dangling refs, invalid contextIds)
- ✅ Semantic reference validation
- ✅ Entity-as-requirement warning
- ✅ Non-atomic requirement warning
- ✅ Historical provider-era schema repair scenario
- ✅ Loader rejects invalid input
- ✅ Quality metrics computation
- ✅ Manifest stats accuracy
- ✅ Prompt version tracking

---

## 7. Definition of Done Checklist

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Package builds without errors | ✅ |
| 2 | Type-check passes (strict mode) | ✅ |
| 3 | 50+ unit tests pass | ✅ (50) |
| 4 | Historical Groq integration test passed at report time | ✅ (historical) |
| 5 | Historical provider-independent AIProvider design | ✅ (historical) |
| 6 | Two-pass architecture (extraction + consolidation) | ✅ |
| 7 | Evidence batching (bounded, flow-centric) | ✅ |
| 8 | Candidate layer (intermediate RequirementCandidate) | ✅ |
| 9 | Deterministic IDs (sorted, REQ-NNNN) | ✅ |
| 10 | Deterministic ordering (provenance→type→statement) | ✅ |
| 11 | Historical AI-proposed dedup | ✅ (historical) |
| 12 | Conflict detection (deterministic; historical AI proposals) | ✅ (historical) |
| 13 | Provenance traceability (100% coverage) | ✅ |
| 14 | Testability assessment (statement analysis) | ✅ |
| 15 | Entity-as-requirement detection | ✅ |
| 16 | Atomicity checking | ✅ |
| 17 | Historical schema repair behavior | ✅ (historical) |
| 18 | Evidence ID sanitization | ✅ |
| 19 | Type inference for "unknown" | ✅ |
| 20 | Quality metrics (explicit/derived/testability) | ✅ |
| 21 | Manifest (stats, usage, warnings) | ✅ |
| 22 | Output files (requirement-ir, manifest, quality, analysis) | ✅ |
| 23 | Resume support (checkpoint-based) | ✅ |
| 24 | CLI entry point | ✅ |
| 25 | No entity→requirement hallucination | ✅ |
| 26 | No invented behavior | ✅ |
| 27 | Explicit/derived distinction | ✅ |
| 28 | Unresolved candidates tracked | ✅ |
| 29 | Conflict tracking | ✅ |
| 30 | Warning system (10 codes) | ✅ |
| 31 | Error system (6 codes) | ✅ |
| 32 | Fingerprint (SHA-256 of inputs) | ✅ |
| 33 | Prompt version tracking | ✅ |
| 34 | Real scenario validated | ✅ |
| 35 | Stops at Requirement IR (no Test Planner) | ✅ |

---

## 8. Known Limitations

1. **Historical provider variability**: Prior Groq runs could vary in candidate counts/statements; this is not a current provider execution path.
2. **Near-duplicate detection**: Jaccard threshold (0.6) may miss semantically similar requirements with very different wording.
3. **Testability heuristic**: Statement-based assessment is approximate.
4. The remaining entries in this historical report describe the then-current implementation, not a guarantee about current code.

---

## 9. Token Efficiency

| Metric | Value |
|--------|-------|
Historical provider-era token and request measurements (not current runtime behavior):
| Metric | Historical value |
|--------|------------------|
| AI Requests | 6 (5 batch extractions + 1 consolidation) |
| Input Tokens | ~10,144 |
| Output Tokens | ~10,619 |
| Total Tokens | ~20,763 |
| Cost per Requirement | ~1,038 tokens |
| Requirements per Request | ~3.3 |

---

## 10. Conclusion

The report-era Requirement Builder transformed Semantic IR into structured requirements. The historical quality figures above describe that earlier implementation only; they do not assert current runtime behavior or provider capability.

The tool is ready for integration into the TIRAI pipeline as the second stage (after Semantic Analyzer, before Test Planner).
