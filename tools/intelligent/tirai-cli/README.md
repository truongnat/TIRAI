# tirai CLI — Workspace + Developer Run Path

Thin product surface over frozen TIRAI core. Composes existing capabilities, does not reimplement them.

## Install / Build

```bash
npm install
npm run build --workspace=tools/intelligent/tirai-cli
# bin is available as `tirai` via package bin
npx tirai --help
# or
node tools/intelligent/tirai-cli/dist/cli.js --help
```

## Quick Start

```bash
# 1. Initialize workspace in your project
tirai init
# creates .tirai/, config.json, mappings/, generated/, runtime/, results/, reports/

# 2. Configure AI provider (env var, not config)
export GROQ_API_KEY=...   # or DEEPSEEK_API_KEY, or use fake for local
# config provider is `fake` by default; set to groq/deepseek in .tirai/config.json if needed

# 3. Add spec and ingest
tirai ingest ./spec.xlsx
# → canonical TestCases in .tirai/artifacts/

# 4. Generate unit tests from TestCase JSON (no source mapping required)
tirai generate --unit
# Optional: edit .tirai/mappings/unit.json to bind cases to real source symbols
# Optional: edit .tirai/mappings/e2e.json then `tirai generate --e2e`

# 6. Execute (real Chromium + Vitest)
tirai run
# exit 0 = all passed, 1 = business FAIL, 2 = blocked/error

# 7. Report (derives from canonical TestRunResultIR)
tirai report

# 8. Status
tirai status
```

## Workspace Layout

```
.tirai/
  config.json              # versioned, workspaceVersion, ai, e2e.baseUrl, unit.projectRoot
  project.json             # project detection + adapter fingerprint
  mappings/
    e2e.json               # ExecutionMappingIR + UIElementCatalog (commit-friendly)
    unit.json              # UnitTargetCodeMapping[] (commit-friendly)
  artifacts/               # canonical context, semantic, requirements, testplan, testcases, trace
  generated/
    e2e/                   # canonical generated Playwright *.spec.ts
    unit/                  # canonical generated Vitest *.spec.ts
  runtime/
    e2e/                   # materialized copy for execution (separated from generated)
    unit/
  results/                 # canonical TestRunResultIR (e2e-run-result-ir.json, unit-run-result-ir.json)
  reports/                 # latest-summary.md (human view derived from IR)
  state/workspace.json     # minimal state
  .gitignore               # ignores results/reports, keeps config/mappings
```

Generated canonical tests are TIRAI-managed artifacts (default `.tirai/generated/`). Runtime copies are materialized to `.tirai/runtime/` (and for Playwright also to non-hidden `tirai-runtime/` to avoid gitignore/hidden discovery issues). Do not write into your own `tests/` unless you configure that later.

## Configuration

`tirai init` creates `.tirai/config.json`:

```json
{
  "version": 1,
  "workspaceVersion": 1,
  "ai": { "provider": "fake", "model": "fake-model" },
  "project": { "root": "/abs/path", "language": "typescript" },
  "e2e": { "baseUrl": "http://localhost:4173", "startCommand": "node order-app/server.mjs" },
  "unit": { "projectRoot": "/abs/path/order-app" }
}
```

Provider keys are **env vars** (`GROQ_API_KEY`, `DEEPSEEK_API_KEY`), never persisted.

## Exit Codes

- `0` all tests passed
- `1` business test failure (assertion mismatch)
- `2` blocked / configuration / validation / infrastructure error (including 0 tests discovered)

Empty runs are `ERROR` (not PASS).

## Commands

- `tirai init [--force]` — create workspace, detect project, write config, create mapping placeholders.
- `tirai ingest <spec>` — run source-to-testcase pipeline, persist artifacts, update state.
- `tirai generate [--e2e|--unit]` — load TestCases + mappings, generate, validate, persist.
- `tirai run` — materialize to runtime, start E2E target if configured, execute, persist canonical results.
- `tirai report` — print human summary from canonical results.
- `tirai status` — show workspace, source, mappings, generation, latest run.

## Notes

- Generation is deterministic, 0 AI calls, fail-closed.
- `project-adapter` is reused for project detection/fingerprint.
- `execution-mapping-builder` is available via its own CLI; `tirai generate` loads persisted mappings.
- No agentic execution, no PDF, no new framework — generated-code Playwright/Vitest is authoritative.
