# TIRAI — AI-driven Test Orchestration Platform (MVP)

TIRAI is a TypeScript toolchain that turns a specification (Excel) into canonical test cases, then into executable Playwright (E2E) and Vitest (Unit) tests via **trusted, persisted mappings**, and finally into canonical `TestRunResultIR` results.

> **Current status — distributable MVP is complete and frozen.**
>
> - `ORIGINAL EXCEL PRODUCT CORE = COMPLETE`
> - `DEVELOPER RUNNABLE MVP = COMPLETE` (Phase 6.0)
> - `DISTRIBUTABLE MVP = COMPLETE` (Phase 6.1)
>
> Install the packaged CLI and run the full pipeline outside the monorepo — see **Installation** below.

---

## Supported pipeline (proven end-to-end)

```
Excel / Markdown
      ↓
Canonical Context (source-ingestion)
      ↓
Semantic IR (semantic-analyzer)
      ↓
Requirement (requirement-builder)
      ↓
Scenario / TestCase (test-planner)
      ↓
Canonical TestCase JSON
      ↓
Trusted Mapping (human-owned, persisted)
      ├── E2E ExecutionMappingIR + UIElementCatalog
      └── Unit Target-Code Mapping (symbol + fingerprint)
      ↓
Generated Code (deterministic, 0 AI)
      ├── Playwright *.spec.ts
      └── Vitest *.spec.ts
      ↓
Real Execution
      ├── Chromium (Playwright)
      └── Vitest
      ↓
TestRunResultIR (canonical)
      ↓
JSON + Markdown Report
```

**Trust boundary:** AI/spec determines *what* to test. Trusted mappings determine *where/how* it connects to the project. TIRAI never guesses an unresolved selector, symbol, route, or assertion — it **fails closed** (`BLOCKED` / `STALE_MAPPING`).

---

## Installation

### From repository (development)

```bash
npm install
npm run build:all
npx tirai --help
```

### From distributable tarball (proven outside monorepo)

The distributable is produced via `tirai-cli`:

```bash
cd tools/intelligent/tirai-cli
npm pack              # creates tirai-cli-1.0.0.tgz (132K, 58 files)
# in a clean external TypeScript project:
npm init -y
npm install /absolute/path/to/tirai-cli-1.0.0.tgz
npm install -D @playwright/test vitest typescript  # target project owns frameworks
npx tirai --help
```

> The published package is self-contained (bundled via esbuild, 466K). No `file:` workspace deps remain. `prepack` strips `file:` deps before `npm pack`.

Public registry publication is not yet configured — tarball/local install is the proven path. Do not document `npm install tirai` unless it is published.

---

## Quick Start (external project, 5 commands)

```bash
# 1. Create/open a TypeScript project
mkdir my-app && cd my-app
npm init -y
npm install -D @playwright/test vitest typescript
npx playwright install chromium   # required once for E2E

# 2. Install TIRAI and initialize workspace
npm install /path/to/tirai-cli-1.0.0.tgz
npx tirai init
# → creates .tirai/ (config, mappings, artifacts, generated, runtime, results, reports)

# 3. Configure provider (env, never in config)
export GROQ_API_KEY=...   # or DEEPSEEK_API_KEY, or keep fake for local
# .tirai/config.json: { "ai": { "provider": "fake" } } is the default

# 4. Ingest a real Excel spec
npx tirai ingest ./spec.xlsx
# → .tirai/artifacts/testcases.json  (inspect it)

# 5. Create trusted mappings (human-owned, persisted, diffable)
# .tirai/mappings/e2e.json  — UIElementCatalog + ExecutionMappingIR
# .tirai/mappings/unit.json — UnitTargetCodeMapping[]

# 6. Generate
npx tirai generate
# → .tirai/generated/e2e/*.spec.ts  +  .tirai/generated/unit/*.spec.ts

# 7. Execute
npx tirai run
# → real Chromium + Vitest, .tirai/results/e2e-run-result-ir.json

# 8. Inspect
npx tirai report
# → .tirai/reports/latest-summary.md
npx tirai status
```

**Critical:** `spec.xlsx → TestCase → trusted mapping → generated tests`. Do not expect `spec.xlsx` to become runnable tests without mappings.

---

## Minimal end-to-end example

Business rule (Excel):

```
If quantity > availableStock → valid=false, reason=INSUFFICIENT_STOCK
Else → valid=true
```

```ts
// src/validateOrder.ts (or order-app/order-validation.ts)
export function validateOrder(quantity: number, availableStock: number): string {
  return quantity > availableStock ? 'INSUFFICIENT_STOCK' : 'ACCEPTED';
}
```

**Unit mapping** (`.tirai/mappings/unit.json`):

```json
{
  "mappings": [{
    "testCaseId": "TC-0001",
    "symbolRef": { "sourceFile": "order-validation.ts", "symbolName": "validateOrder" },
    "argumentInputNames": ["quantity", "availableStock"],
    "expectedResultIndex": 0,
    "assertionType": "primitive-equal",
    "targetFingerprint": "<sha256 of file content>"
  }]
}
```

**E2E mapping** (`.tirai/mappings/e2e.json`):

```json
{
  "schemaVersion": "1.0",
  "testMappings": [{
    "testCaseId": "TC-0001",
    "status": "ready",
    "ui": {
      "stepMappings": [
        { "stepOrder": 1, "action": "navigate", "valueLiteral": "/" },
        { "stepOrder": 2, "action": "fill", "targetLogicalName": "quantity", "valueLiteral": "10" },
        { "stepOrder": 3, "action": "fill", "targetLogicalName": "availableStock", "valueLiteral": "5" },
        { "stepOrder": 4, "action": "click", "targetLogicalName": "submit" }
      ],
      "assertionMappings": [
        { "expectedResultIndex": 0, "assertionType": "text-contains", "targetLogicalName": "result", "expectedValue": "INSUFFICIENT_STOCK" }
      ]
    }
  }],
  "catalogs": { "uiCatalog": { "environmentId": "order-app", "pages": [{ "id": "order", "route": "/", "elements": [
    { "logicalName": "quantity", "locator": { "strategy": "test-id", "value": "quantity" } },
    { "logicalName": "availableStock", "locator": { "strategy": "test-id", "value": "availableStock" } },
    { "logicalName": "submit", "locator": { "strategy": "test-id", "value": "submit" } },
    { "logicalName": "result", "locator": { "strategy": "test-id", "value": "result" } }
  ] }] } }
}
```

Stale fingerprint → `tirai generate` fails with `STALE_MAPPING` (never silently uses stale code).

---

## Workspace layout

```
.tirai/
  config.json          # version:1, workspaceVersion:1, ai.provider, e2e.baseUrl, unit.projectRoot
  project.json         # detection + project-adapter fingerprint
  mappings/
    e2e.json           # commit-friendly
    unit.json          # commit-friendly
  artifacts/           # canonical JSON (context, semantic-ir, requirements, test-plan, testcases, trace)
  generated/
    e2e/               # TIRAI-owned Playwright source
    unit/              # TIRAI-owned Vitest source
  runtime/
    e2e/               # materialized copy (separated from generated)
    unit/
  results/             # TestRunResultIR (e2e-run-result-ir.json, unit-run-result-ir.json)
  reports/             # latest-summary.md (derived from IR)
  state/workspace.json # source hash, TestCase counts, generation/run status
  .gitignore           # ignores results/reports, keeps config/mappings
```

`tirai-runtime/e2e/` (non-hidden, at project root) is used as the Playwright exec dir to avoid hidden/gitignore discovery issues — see `tirai run` implementation.

Generated tests are **not** written into `tests/` or `src/` unless you configure that in a future phase.

---

## CLI reference

```
tirai --help
tirai --version        # 1.0.0 from package.json

tirai init [--force]           # create .tirai/, detect project, write config
tirai ingest <spec> [--json]   # Excel/Markdown → canonical artifacts
tirai generate [--e2e|--unit]  # TestCase + mapping → generated code (validates)
tirai run [--json]             # materialize → real Chromium/Vitest → IR (exit 0 pass, 1 fail, 2 blocked/error)
tirai report [--json]          # summary from IR
tirai status [--json]          # workspace state
```

---

## Source support

| Source     | Status                         |
|------------|--------------------------------|
| Excel (.xlsx) | **PROVEN** — full pipeline, deterministic, 1 TestCase from order validation |
| Markdown (.md) | SUPPORTED_BUT_NOT_PRODUCT_ACCEPTED — connector exists, not exercised in acceptance |
| PDF        | NOT_IMPLEMENTED                |
| Other      | NOT_IMPLEMENTED                |

---

## Generated test support

| Framework | Status | Language | Proven |
|-----------|--------|----------|--------|
| Playwright| PROVEN | TypeScript | E2E via ExecutionMappingIR + UIElementCatalog, 0 AI, fail-closed |
| Vitest    | PROVEN | TypeScript | Unit via AST inspection + fingerprint, 0 AI, fail-closed |
| Jest/Cypress/Selenium/Python/Java | NOT_IMPLEMENTED | — | — |

---

## AI boundaries

| Stage                  | AI allowed? | Authoritative? |
|------------------------|-------------|----------------|
| Source understanding   | Yes (fake/groq/deepseek) | semantic assistance |
| Requirement/TestCase planning | Yes | within canonical planning |
| E2E trusted mapping    | No guessing | **No** — must be human-provided, fail-closed |
| Unit target mapping    | No AI authority | **No** — exact symbol + fingerprint |
| Playwright generation  | **No** | deterministic, 0 AI |
| Vitest generation      | **No** | deterministic, 0 AI |
| Test execution         | **No** | real runner |
| Result mapping         | **No** | deterministic |

Hard invariants (always 0 in acceptance):

```
generationAiCalls = 0
executionAiCalls = 0
agenticFallbacks = 0
guessedMappings = 0
aiSymbolGuesses = 0
```

---

## Result semantics

```
PASS    — test executed, assertions passed
FAIL    — test executed, business assertion mismatch (exit 1)
ERROR   — infrastructure (browser, network, 0 tests discovered) (exit 2)
BLOCKED — TIRAI refused: missing/ambiguous/stale mapping, unsupported, invalid config (exit 2)
```

`0 discovered tests != PASS` — empty run is `ERROR`.

---

## Security model

- API keys via env only: `GROQ_API_KEY`, `DEEPSEEK_API_KEY` (verify in `ai-provider`).
- Never persisted in `.tirai/config.json`, mappings, artifacts, generated, results, reports, or tarball.
- `secretLeakCount = 0`, `packageSecretLeakCount = 0` in acceptance.
- `applicationSourceMutations = 0` — TIRAI never mutates user source; only `.tirai/` is written.

---

## Development commands (inside monorepo)

```bash
npm run build:all
npm run typecheck:all
npm run lint:all
npm test --workspaces --if-present

# specific
npm run check --workspace=tools/intelligent/tirai-cli
npm run check --workspace=tools/intelligent/test-code-generator
npm run check --workspace=tools/intelligent/source-to-testcase
```

---

## Product status

```
ORIGINAL EXCEL PRODUCT CORE = COMPLETE
DEVELOPER RUNNABLE MVP      = COMPLETE (Phase 6.0)
DISTRIBUTABLE MVP           = COMPLETE (Phase 6.1) — tarball installs outside monorepo, full pipeline passes
```

**Current MVP scope / limitations (honest):**

- Excel is the proven primary source; Markdown connector exists but not product-accepted; PDF not implemented.
- Playwright (E2E) and Vitest (Unit) on TypeScript are the only proven generated frameworks.
- Trusted mappings are **required** — TIRAI does not guess selectors/symbols.
- Browser binaries must exist (`npx playwright install chromium`) for E2E; missing → `ERROR`.
- No autonomous mapping, no cloud, no dashboard, no incremental CI — these are future decisions, not MVP blockers.

**Next decisions are product decisions, not required to complete the MVP.**

---

## Architecture

```
Source Connector (Excel/Markdown)
        ↓
Canonical Context
        ↓
Semantic Analyzer → Semantic IR
        ↓
Requirement Builder → Requirement IR
        ↓
Test Planner → Scenario / TestCase (Canonical TestCase JSON)
        ↓
Mapping Boundary (human-owned, persisted)
        ├── E2E: ExecutionMappingIR + UIElementCatalog
        └── Unit: Target-Code Mapping + fingerprint
        ↓
Test Code Generator
        ├── Playwright Adapter (deterministic)
        └── Vitest Adapter (deterministic, AST + fingerprint)
        ↓
Runner (real)
        ├── Playwright Chromium
        └── Vitest
        ↓
TestRunResultIR (canonical)
        ↓
Reporter (JSON + Markdown)
```

Advanced/experimental modules (`agentic-test-executor`, `e2e-runner`, `execution-engine`, `test-data-planner`, etc.) remain in the repository but are **not** part of the distributable MVP path. Primary docs center the flow above.

---

## Package

- **Name:** `tirai-cli`
- **Version:** `1.0.0`
- **Bin:** `tirai -> dist/cli.js` (bundled ESM via esbuild, 466K)
- **Install (proven):** `npm install /path/to/tirai-cli-1.0.0.tgz` (132K packed, 646K unpacked, 58 files)
- **External acceptance:** `output/phase-6-1-release-readiness/external-project/` (full `tirai init` → `report` via installed tarball, 1 TestCase → 1 Playwright + 1 Vitest → PASS)

---

## License

MIT
