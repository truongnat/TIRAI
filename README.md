# TIRAI — AI-driven Test Orchestration Platform

TIRAI turns software specifications into canonical test cases, generates executable Playwright (E2E) and Vitest (Unit) tests through trusted mappings, executes them with real runners, and exports canonical `TestRunResultIR` results.

## Pipeline

```text
Excel / PDF / DOCX / Markdown / CSV / JSON / URL
        ↓
Canonical Context
        ↓
Semantic Analysis
        ↓
Requirement / Scenario / TestCase
        ↓
Canonical TestCase JSON
        ↓
Trusted Mapping
   ┌────────────┴────────────┐
   ↓                         ↓
E2E Mapping             Unit Target Mapping
   ↓                         ↓
Playwright *.spec.ts     Vitest *.spec.ts
   ↓                         ↓
Real Chromium            Real Vitest
   └────────────┬────────────┘
                ↓
        TestRunResultIR
                ↓
          JSON + Markdown
```

**Trust boundary:** specifications/AI determine **what** to test. Trusted mappings determine **where/how** the test connects to the target project. Generation and execution do not guess unresolved selectors, routes, symbols, or assertions; unresolved mappings fail closed.

## Install

Requires **Node.js 20+** and npm.

TIRAI now ships through GitHub Release assets. Each release contains a packaged `tirai-cli-*.tgz` and SHA256 checksum.

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/truongnat/TIRAI/main/install.sh | bash
```

For this repository while it is private:

```bash
export GITHUB_TOKEN=<github-token-with-repo-read-access>
curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://raw.githubusercontent.com/truongnat/TIRAI/main/install.sh | bash
```

The installer also accepts `GH_TOKEN`.

### Windows CMD

Download `install.cmd` from the repository, then run:

```cmd
set GITHUB_TOKEN=<github-token-with-repo-read-access>
install.cmd
```

When the repository becomes public, the token is no longer required.

### Install a specific version

Linux/macOS:

```bash
TIRAI_VERSION=1.0.0 ./install.sh
```

Windows CMD:

```cmd
set TIRAI_VERSION=1.0.0
install.cmd
```

The installer:

```text
checks Node.js/npm
      ↓
resolves latest or requested GitHub Release
      ↓
downloads tirai-cli-*.tgz
      ↓
verifies SHA256 when published
      ↓
npm install --global
      ↓
verifies tirai --version
```

> A GitHub Release must exist before the release-based installer can install TIRAI. Releases are produced automatically from `v*` tags by `.github/workflows/release-cli.yml`.

Full installation details: [`docs/installation.md`](docs/installation.md).

## Create a release

The CLI package version and Git tag must match.

```bash
# package.json version example: 1.0.0
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions then:

```text
npm ci
  ↓
CLI check
  ↓
npm pack
  ↓
SHA256
  ↓
GitHub Release
  ├── tirai-cli-1.0.0.tgz
  └── tirai-cli-1.0.0.tgz.sha256
```

The workflow can also be triggered manually to build the package as a workflow artifact without creating a release.

## Quick start

After installation:

```bash
tirai --version
tirai --help

cd my-project
tirai init
```

Configure the AI provider through environment variables when required:

```bash
export GROQ_API_KEY=...
# or
export DEEPSEEK_API_KEY=...
```

Then ingest a specification:

```bash
tirai ingest ./spec.xlsx
# or
tirai ingest ./spec.pdf
tirai ingest ./spec.docx
tirai ingest ./spec.csv
tirai ingest ./spec.json
tirai ingest ./spec.md
```

TIRAI writes its workspace under `.tirai/`.

```text
.tirai/
  config.json
  project.json
  mappings/
    e2e.json
    unit.json
  artifacts/
  generated/
    e2e/
    unit/
  runtime/
    e2e/
    unit/
  results/
  reports/
  state/
```

Inspect the generated canonical TestCases before mapping:

```bash
tirai status
tirai generate
tirai run
tirai report
```

## Trusted mappings

A specification does **not** automatically become executable code by guessing project details.

TIRAI keeps an explicit mapping boundary:

```text
Canonical TestCase
       ↓
Trusted Mapping
   ┌───────┴───────┐
   ↓               ↓
UI selector      Source symbol
/ route          + fingerprint
   ↓               ↓
Playwright       Vitest
```

Mappings live in:

```text
.tirai/mappings/e2e.json
.tirai/mappings/unit.json
```

Missing, ambiguous, or stale mappings are blocked rather than guessed.

## Source support

| Source | Current support |
|---|---|
| Excel `.xlsx` | Supported; original end-to-end product path proven |
| Markdown `.md` | Supported |
| PDF `.pdf` | Supported by local PDF connector |
| DOCX `.docx` | Supported |
| CSV `.csv` | Supported |
| JSON `.json` | Supported |
| URL / HTML | Supported by URL connector |

The additional source connectors extend ingestion; they do not change the canonical TestCase → trusted mapping → generated-code trust boundary.

## Generated tests

| Framework | Type | Language | Generation |
|---|---|---|---|
| Playwright | E2E | TypeScript | deterministic, 0 AI |
| Vitest | Unit | TypeScript | deterministic, 0 AI |

Other test frameworks are not part of the currently proven generated-code path.

## CLI

```text
tirai --help
tirai --version

tirai init [--force]
tirai ingest <spec> [--json]
tirai generate [--e2e|--unit]
tirai run [--json]
tirai report [--json]
tirai status [--json]
```

Exit semantics:

```text
0 = PASS
1 = business assertion FAIL
2 = BLOCKED / configuration / validation / infrastructure ERROR
```

`0 tests discovered` is an error, never a pass.

## AI boundaries

| Stage | AI |
|---|---|
| Source understanding / semantic analysis | allowed |
| Requirement / TestCase planning | allowed |
| Trusted E2E mapping authority | no guessing |
| Trusted Unit target mapping authority | no guessing |
| Playwright generation | 0 AI |
| Vitest generation | 0 AI |
| Test execution | 0 AI |
| Result mapping | 0 AI |

Core generation/execution invariants:

```text
generationAiCalls = 0
executionAiCalls = 0
agenticFallbacks = 0
guessedMappings = 0
aiSymbolGuesses = 0
```

## Security

- Provider API keys are environment variables, not workspace configuration.
- Generated source and canonical results must not contain raw provider secrets.
- TIRAI-owned artifacts live under `.tirai/` / runtime output rather than mutating application source.
- Stale target fingerprints fail closed.
- Release installers verify SHA256 when a checksum asset is present.
- Private GitHub installation supports `GITHUB_TOKEN` / `GH_TOKEN`; tokens are not persisted by the installer.

## Development

Inside the monorepo:

```bash
npm install
npm run build:all
npm run typecheck:all
npm run lint:all
npm test --workspaces --if-present
```

CLI-specific verification:

```bash
npm run check --workspace=tools/intelligent/tirai-cli
```

The distributable package remains `tirai-cli`, exposing:

```text
tirai -> dist/cli.js
```

## Product status

```text
ORIGINAL EXCEL PRODUCT CORE = COMPLETE
DEVELOPER RUNNABLE MVP      = COMPLETE
DISTRIBUTABLE CLI           = COMPLETE
GITHUB RELEASE INSTALL PATH = IMPLEMENTED
```

The original Excel → TestCase → Playwright/Vitest → canonical result pipeline remains the proven core. PDF, DOCX, CSV, JSON, URL, and Markdown ingestion now broaden the supported input surface without replacing that core architecture.

## License

MIT
