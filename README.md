<div align="center">

# ⚡ TIRAI

### From specification to executable tests. Automatically.

**AI-assisted specification intelligence with deterministic test generation and real execution.**

Turn **Excel, PDF, DOCX, Markdown, CSV, JSON, and web specifications** into canonical test cases, generate trusted **Playwright** and **Vitest** suites, execute them with real runners, and export canonical results.

<p>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" />
  <img alt="Node" src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white" />
  <img alt="Playwright" src="https://img.shields.io/badge/E2E-Playwright-2EAD33?logo=playwright&logoColor=white" />
  <img alt="Vitest" src="https://img.shields.io/badge/Unit-Vitest-6E9F18?logo=vitest&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue" />
  <img alt="CLI" src="https://img.shields.io/badge/CLI-tirai-black?logo=gnometerminal&logoColor=white" />
</p>

<p>
  <a href="#-install">Install</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-supported-sources">Sources</a> •
  <a href="#-trusted-mapping-boundary">Trust Model</a> •
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

</div>

---

## ✨ What is TIRAI?

Most test automation tools start from code. **TIRAI starts from specifications.**

```text
Specification
    ↓
Semantic understanding
    ↓
Canonical TestCase JSON
    ↓
Trusted project mapping
    ↓
Generated Playwright / Vitest
    ↓
Real execution
    ↓
Canonical results
```

TIRAI keeps AI where it is useful — understanding intent — while keeping generation and execution deterministic, inspectable, and fail-closed.

### Why it is different

- 🧠 **Specification-first** — ingest business specs instead of hand-authoring every test from scratch.
- 🧩 **Canonical JSON in the middle** — source format and test framework stay decoupled.
- 🔐 **Trusted mapping boundary** — no silent selector or symbol guessing.
- ⚙️ **Deterministic generators** — Playwright and Vitest code generation uses 0 AI calls.
- 🧪 **Real execution** — Chromium and Vitest are executed for real; no simulated PASS.
- 📦 **Developer-ready CLI** — initialize, ingest, generate, run, report, and inspect status from one command surface.
- 🌐 **Multi-source ingestion** — Excel, PDF, DOCX, Markdown, CSV, JSON, and URL connectors.

---

## 🧭 End-to-end pipeline

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
               TRUSTED MAPPING BOUNDARY
                 ┌──────┴──────┐
                 ↓             ↓
              E2E Map       Unit Map
                 ↓             ↓
            Playwright       Vitest
             *.spec.ts       *.spec.ts
                 ↓             ↓
          Real Chromium    Real Vitest
                 └──────┬──────┘
                        ↓
                 TestRunResultIR
                        ↓
                JSON + Markdown
```

> **AI/specification logic determines what should be tested. Trusted mappings determine where and how those tests connect to the real project.**

---

## 🚀 Install

Requires **Node.js 20+** and npm.

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/truongnat/TIRAI/main/install.sh | bash
```

### Windows

Download [`install.cmd`](install.cmd), then run:

```cmd
install.cmd
```

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

The installer uses the latest [GitHub Release](https://github.com/truongnat/TIRAI/releases/latest) (`v1.0.0`), downloads `tirai-cli-*.tgz`, verifies SHA256, installs globally with npm, and checks `tirai --version`. New versions are published from `v*` tags by `.github/workflows/release-cli.yml`.

See [`docs/installation.md`](docs/installation.md) for full installation details.

---

## ⚡ Quick Start

```bash
# verify installation
tirai --version
tirai --help

# open your target project
cd my-project

# initialize the TIRAI workspace
tirai init

# ingest a specification
tirai ingest ./spec.xlsx

# inspect generated canonical test cases
tirai status

# configure trusted mappings under .tirai/mappings/

# generate Playwright + Vitest test code
tirai generate

# execute real tests
tirai run

# export/read the result summary
tirai report
```

Provider credentials remain environment variables:

```bash
export GROQ_API_KEY=...
# or
export DEEPSEEK_API_KEY=...
```

TIRAI writes project-owned state under:

```text
.tirai/
├── config.json
├── project.json
├── mappings/
│   ├── e2e.json
│   └── unit.json
├── artifacts/
├── generated/
│   ├── e2e/
│   └── unit/
├── runtime/
├── results/
├── reports/
└── state/
```

---

## 🛡️ Trusted mapping boundary

TIRAI intentionally does **not** turn an unresolved TestCase into executable project code by guessing.

```text
Canonical TestCase
       ↓
Trusted Mapping
   ┌───────┴────────┐
   ↓                ↓
UI route /       Source symbol
selector         + fingerprint
   ↓                ↓
Playwright        Vitest
```

Mappings are persisted and reviewable:

```text
.tirai/mappings/e2e.json
.tirai/mappings/unit.json
```

If a mapping is missing, ambiguous, unsupported, or stale, TIRAI fails closed instead of inventing authority.

---

## 📚 Supported sources

| Source | Connector status | Notes |
|---|---:|---|
| Excel `.xlsx` | ✅ | Original end-to-end product path, fully proven |
| PDF `.pdf` | ✅ | Local PDF connector |
| DOCX `.docx` | ✅ | Document text ingestion |
| Markdown `.md` | ✅ | Structured text ingestion |
| CSV `.csv` | ✅ | Tabular ingestion |
| JSON `.json` | ✅ | Structured JSON ingestion |
| URL / HTML | ✅ | Remote HTML → canonical content |

All source connectors converge into the same downstream canonical pipeline.

---

## 🧪 Generated test support

| Framework | Type | Language | Generation | Runtime |
|---|---|---|---|---|
| Playwright | E2E | TypeScript | deterministic, 0 AI | real Chromium |
| Vitest | Unit | TypeScript | deterministic, 0 AI | real Vitest |

Other frameworks can be added behind the canonical TestCase boundary without changing source ingestion.

---

## 🏗️ Architecture

```text
┌─────────────────────────────────────────────┐
│               SOURCE LAYER                  │
│ Excel · PDF · DOCX · MD · CSV · JSON · URL │
└──────────────────────┬──────────────────────┘
                       ↓
┌─────────────────────────────────────────────┐
│           INTELLIGENCE / SEMANTIC           │
│ Context → Semantic IR → Requirement → Test  │
└──────────────────────┬──────────────────────┘
                       ↓
┌─────────────────────────────────────────────┐
│             CANONICAL TESTCASE              │
│         Product truth between stages        │
└──────────────────────┬──────────────────────┘
                       ↓
             TRUSTED MAPPING BOUNDARY
                 ┌─────┴─────┐
                 ↓           ↓
┌──────────────────────┐ ┌──────────────────────┐
│  E2E CODE GENERATOR  │ │ UNIT CODE GENERATOR  │
│      Playwright      │ │        Vitest        │
└──────────┬───────────┘ └──────────┬───────────┘
           ↓                        ↓
      Real Chromium             Real Vitest
           └───────────┬────────────┘
                       ↓
┌─────────────────────────────────────────────┐
│             TestRunResultIR                 │
│        PASS · FAIL · ERROR · BLOCKED        │
└─────────────────────────────────────────────┘
```

### Core design principles

```text
Sources describe WHAT should be tested.
Canonical JSON is intermediate product truth.
Trusted mappings bind truth to the real project.
Deterministic generators create executable tests.
Real runners produce canonical results.
```

---

## 🤖 AI boundaries

| Stage | AI allowed? | Runtime authority? |
|---|---:|---:|
| Source understanding | ✅ | No |
| Semantic analysis | ✅ | No |
| Requirement/TestCase planning | ✅ | No |
| E2E trusted mapping | No guessing | Human/project authority |
| Unit target mapping | No guessing | Exact symbol/fingerprint |
| Playwright generation | ❌ | Deterministic |
| Vitest generation | ❌ | Deterministic |
| Test execution | ❌ | Real runner |
| Result mapping | ❌ | Deterministic |

Acceptance invariants for generated-code execution:

```text
generationAiCalls = 0
executionAiCalls = 0
agenticFallbacks = 0
guessedMappings = 0
aiSymbolGuesses = 0
```

---

## 📊 Result semantics

```text
PASS    test executed and assertions passed
FAIL    test executed but business/assertion expectation failed
ERROR   runtime / browser / network / discovery / infrastructure failure
BLOCKED TIRAI intentionally refused unsafe or unresolved execution
```

`0 tests discovered` is **ERROR**, never PASS.

---

## 🧰 CLI reference

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

Exit codes:

```text
0 = PASS
1 = business assertion FAIL
2 = BLOCKED / validation / configuration / infrastructure ERROR
```

---

## 🔐 Security model

- Provider API keys are read from environment variables, not persisted workspace config.
- Generated code and canonical results must not contain raw provider credentials.
- TIRAI writes managed state under `.tirai/` / runtime output instead of mutating application source.
- Unit target fingerprints protect against stale symbol mappings.
- Release installers verify SHA256 when checksum assets are available.
- Missing authority fails closed.

For security reports, see [`SECURITY.md`](SECURITY.md).

---

## 🧑‍💻 Development

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

Package surface:

```text
package: tirai-cli
bin:     tirai -> dist/cli.js
```

---

## 📦 Release flow

```bash
# package version must match the release tag
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions performs:

```text
npm ci
  ↓
CLI verification
  ↓
npm pack
  ↓
SHA256
  ↓
GitHub Release
  ├── tirai-cli-<version>.tgz
  └── tirai-cli-<version>.tgz.sha256
```

---

## 🟢 Project status

```text
ORIGINAL EXCEL PRODUCT CORE = COMPLETE
DEVELOPER RUNNABLE MVP      = COMPLETE
DISTRIBUTABLE CLI           = COMPLETE
MULTI-SOURCE INGESTION      = AVAILABLE
```

The original Excel → TestCase → trusted mapping → Playwright/Vitest → canonical result flow remains the proven product core. Additional connectors broaden the input surface without changing that trust model.

---

## 🤝 Contributing

Contributions are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), then use the issue templates for bug reports or feature proposals.

## 📄 License

MIT
