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
  <a href="#-cli-reference">CLI Reference</a> •
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
Multi-format export / Execution
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
- 📄 **Multi-format export** — JSON, Excel, Markdown, PDF, DOCX output.

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
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
   Multi-format    Platform-aware    Optional Code
     Export          Execution       Generation
   (JSON/XLSX/      (Web/API/DB)    (Playwright/
    PDF/DOCX/                       Vitest)
    Markdown)
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

```bash
TIRAI_VERSION=1.0.0 ./install.sh
```

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

# add a specification to the registry
tirai spec add ./spec.xlsx

# inspect registered specs
tirai spec list

# configure target platform
tirai target add web --environment staging --url https://staging.example.com

# generate canonical test plan
tirai plan

# export test cases to multiple formats
tirai export --format all

# execute tests against platform
tirai execute --platform web --environment staging

# optional: generate Playwright tests (requires E2E mapping)
tirai generate --target playwright

# optional: generate Vitest tests (requires source mapping)
tirai generate --target vitest --source-mapping ./unit.json
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
├── artifacts/          # Canonical IR (source of truth)
│   ├── requirements.json
│   ├── test-plan.json
│   └── testcases.json
├── specs/              # Specification registry
│   └── index.json
├── outputs/            # Export outputs
│   ├── json/
│   ├── excel/
│   ├── pdf/
│   ├── docx/
│   └── markdown/
├── generated/          # Code generation output
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

When no trusted mapping exists, TIRAI produces a **spec preview artifact** (not a test) showing inputs/expected values for human review. It does not call application code and cannot verify behavior. It will never be reported as a unit test. A trusted `unit.json` mapping, when present, binds the same case to a real source symbol. E2E still requires a trusted mapping; missing, ambiguous, unsupported, or stale E2E/source mappings fail closed instead of inventing selectors or symbols.

---

## 🧰 CLI reference

```text
tirai --help
tirai --version

tirai init [--force]
tirai ingest <spec> [--json]
tirai spec add <source-path> [--name NAME] [--language LANG]
tirai spec list
tirai spec inspect <spec-id>

tirai target list
tirai target add <platform> <environment> --url <url>
tirai target validate

tirai plan [--json]

tirai export --format all|json|xlsx|markdown|pdf|docx [--out <dir>]
tirai execute --platform web|backend|database [--environment <env>]

tirai generate --target playwright|vitest [--source-mapping <path>]
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

## 📄 Export formats

| Format | Description |
|---|---|
| JSON | Canonical machine-readable output, full fidelity |
| Excel (.xlsx) | Multi-sheet workbook with Test Cases, Steps, Expected Results, Data Needs, Summary |
| Markdown | Git-friendly readable tables and sections |
| PDF | Printable document with all test case details |
| DOCX/Word | Editable document for stakeholders |

Export never executes tests and never mutates canonical IR.

---

## 🧪 Generated test support

| Framework | Type | Language | Generation | Runtime |
|---|---|---|---|---|
| Playwright | E2E | TypeScript | deterministic, 0 AI | real Chromium |
| Vitest | Unit | TypeScript | deterministic, 0 AI | real Vitest |

Playwright/Vitest generation requires trusted mappings. Without mappings, TIRAI produces preview artifacts (not tests).

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
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
   Multi-format    Platform-aware   Optional Code
     Export          Execution      Generation
                    (Web/API/DB)   (Playwright/Vitest)
```

### Core design principles

```text
Sources describe WHAT should be tested.
Canonical JSON is intermediate product truth.
Trusted mappings bind truth to the real project.
Deterministic generators create executable tests.
Real runners produce canonical results.
```

### Security model

- Provider API keys are read from environment variables, never persisted workspace config.
- Generated code and canonical results must not contain raw provider credentials.
- TIRAI writes managed state under `.tirai/` instead of mutating application source.
- Unit target fingerprints protect against stale symbol mappings.
- Missing authority fails closed.

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

## 🟢 Project status

```text
SPEC-FIRST PLATFORM CORE    = COMPLETE
MULTI-SOURCE INGESTION      = COMPLETE
MULTI-FORMAT EXPORT         = COMPLETE
PLATFORM-AWARE EXECUTION    = COMPLETE
OPTIONAL WHITE-BOX OUTPUT   = COMPLETE
```

---

## 🤝 Contributing

Contributions are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), then use the issue templates for bug reports or feature proposals.

## 📄 License

MIT
