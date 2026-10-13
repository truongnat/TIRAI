# TIRAI — Current Product Status

**Baseline:** `DISTRIBUTABLE_MVP_CODE_BASELINE=234ab8d`  
**Documentation baseline:** will be final commit after this docs update  
**Date:** 2026-08-30

## MVP Status

```
ORIGINAL EXCEL PRODUCT CORE = COMPLETE
DEVELOPER RUNNABLE MVP      = COMPLETE (Phase 6.0)
DISTRIBUTABLE MVP           = COMPLETE (Phase 6.1, 100/100 gates)
```

The distributable CLI (`tirai-cli@1.0.0`, `tirai -> dist/cli.js`) installs from its tarball into a clean external TypeScript project and executes:

```
tirai init → ingest spec.xlsx → generate → run (Chromium + Vitest) → report
```

without custom orchestration code, outside the monorepo source tree.

## Spec-first Web-Testing Pilot

This pilot is separate from the proven generated-code MVP above. The repository includes a host-AI Skill and CLI workflow for human-reviewed, black-box functional UI testing. The Skill is designed for tester chat; TIRAI is tool-only with no internal providers — the host agent (Codex, Claude Code, Antigravity) performs all semantic analysis and judgment and hands canonical artifacts to TIRAI through `tirai artifact import`. It is not release-accepted until exercised against a live non-production app.

- Local specifications: Excel, Markdown, and HTML. Confluence is a future provider; v1 requires a local export.
- Scope: functional UI only, local/dev/staging only, dedicated test tenant, explicit tester approval of routes/cases, and per-run reconfirmation.
- Ambiguous requirements block affected cases until the tester answers; generated cases retain requirement provenance and approvals are fingerprint-bound.
- Reports include per-run snapshots, sanitized evidence, and local bug-draft candidates requiring tester confirmation.
- Requires a host agent that performs the analysis and imports artifacts, plus Chromium for web execution. TIRAI does not install browsers automatically.
- API, visual, accessibility, performance, production, tracker integrations, and CI execution are outside this pilot.

## Proven Pipeline

```
Excel (.xlsx) → Canonical Context → Semantic IR → Requirement → Scenario → TestCase (JSON)
        ↓
Trusted Mapping (E2E + Unit, persisted, human-owned, fail-closed)
        ↓
Playwright *.spec.ts + Vitest *.spec.ts (deterministic, 0 AI)
        ↓
Real Chromium + Real Vitest → TestRunResultIR → JSON + Markdown
```

## Proven Source Support

| Source | Status |
|--------|--------|
| Excel (.xlsx) | PROVEN (full pipeline) |
| Markdown (.md) | SUPPORTED_BUT_NOT_PRODUCT_ACCEPTED (connector exists) |
| HTML (.html) | SUPPORTED_BUT_NOT_PRODUCT_ACCEPTED (connector exists) |
| PDF | SUPPORTED_BUT_NOT_PRODUCT_ACCEPTED (connector exists) |
| Other | NOT_IMPLEMENTED |

## Proven Generated Frameworks

| Framework | Language | Status |
|-----------|----------|--------|
| Playwright | TypeScript | PROVEN |
| Vitest | TypeScript | PROVEN |
| Others | — | NOT_IMPLEMENTED |

## CLI / Package

- **Package:** `tirai-cli@1.0.0`
- **Bin:** `tirai`
- **Install (proven):** `npm install ./tirai-cli-1.0.0.tgz` (132K packed, 466K bundled)
- **Commands:** `init`, `ingest`, `generate`, `run`, `report`, `status`

## Security / Trust Boundaries

- `generationAiCalls=0`, `executionAiCalls=0`, `agenticFallbacks=0`, `guessedMappings=0`, `aiSymbolGuesses=0`
- `secretLeakCount=0`, `applicationSourceMutations=0`
- Mappings are required; missing/ambiguous/stale → `BLOCKED` (fail-closed)

## Known Limitations (MVP Scope)

- Excel is the only proven full-pipeline source
- Playwright + Vitest on TypeScript only
- Trusted mappings required (no autonomous guessing)
- Browser binaries required for E2E (`npx playwright install chromium`)

## Next Decision Areas (not required for MVP)

- Source coverage expansion (PDF, etc.)
- Mapping UX improvements
- Additional languages/frameworks
- Beyond local CLI (CI integration, etc.)

These are product decisions, not MVP blockers.

## Evidence

- `output/phase-6-1-release-readiness/` — tarball, external-project, logs, gates 100/100
- `output/phase-6-0-workspace-cli/` — Phase 6.0 workspace + CLI acceptance (63/63)
- `output/final-mvp-closure/` — this closure report (after creation)
