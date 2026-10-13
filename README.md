<div align="center">

# ⚡ TIRAI

### From specification to executable tests. Automatically.

**Host-agent specification intelligence with deterministic ingestion, validation, generation, and real execution.**

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
Semantic understanding (host agent)
    ↓
Canonical TestCase JSON
    ↓
Multi-format export / Execution
```

TIRAI makes no model calls itself. The host agent performs semantic understanding and hands canonical artifacts to TIRAI, which keeps ingestion, validation, generation, and execution deterministic, inspectable, and fail-closed.

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
       Host agent analysis → Artifact import
                        ↓
         Requirement / Scenario / TestCase
                        ↓
              Canonical TestCase JSON
                        ↓
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
   Multi-format    Platform-aware   Optional Code
     Export          Execution      Generation
   (JSON/XLSX/    (Web UI only;    (Playwright/
    PDF/DOCX/      API/DB prep)      Vitest)
    Markdown)
```

> **The host agent determines what should be tested. Trusted mappings determine where and how those tests connect to the real project.**

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
```

From the TIRAI checkout, install the Skill into the host assistant you use:

```bash
# Codex
mkdir -p "$HOME/.agents/skills/tirai-web-testing"
cp skills/tirai-web-testing/SKILL.md "$HOME/.agents/skills/tirai-web-testing/SKILL.md"
# Claude Code
mkdir -p "$HOME/.claude/skills/tirai-web-testing"
cp skills/tirai-web-testing/SKILL.md "$HOME/.claude/skills/tirai-web-testing/SKILL.md"
# Antigravity CLI
mkdir -p "$HOME/.gemini/antigravity-cli/skills/tirai-web-testing"
cp skills/tirai-web-testing/SKILL.md "$HOME/.gemini/antigravity-cli/skills/tirai-web-testing/SKILL.md"
```

Open the target application project in the host assistant, then start a chat:

```bash
cd my-project
```

Example request: “Set up TIRAI here, then help me review `./spec.xlsx` against the staging web app.” The Skill asks before initialization and config changes, then guides spec clarification, route/case review, execution approval, and bug-draft confirmation. The host AI runs the TIRAI commands.

### Tool-only architecture

The host assistant (Codex, Claude Code, or Antigravity) reads the `tirai-web-testing` Skill and operates the TIRAI CLI. TIRAI makes no model calls: it runs deterministic ingestion, artifact validation and import, Playwright/Vitest execution, and reporting. The host agent performs semantic analysis, requirement building, test planning, and judgment, then writes `semantic-ir.json`, `requirements.json`, `test-plan.json`, `testcases.json`, and `contract.json` and imports them with `tirai artifact import <kind> --file <path>` (`kind`: `semantic-ir | requirements | test-plan | testcases | contract`). Each artifact is validated on import and written to `.tirai/artifacts/`; invalid or ambiguous input fails closed.

### Human-reviewed web testing

The `tirai-web-testing` Skill guides specification review, clarification, route selection, approved cases, execution, and bug-report drafts through the host AI chat. TIRAI CLI supplies deterministic ingestion, artifact validation/import, real Playwright browser execution, and local run artifacts.

- Web-testing v1 accepts local `.xlsx`/`.xlsm`, `.md`/`.markdown`, and `.html`/`.htm` specifications; Confluence is a future connector.
- The runner is black-box by default, functional UI only, and accepts only local/dev/staging labels. It blocks production-like hostnames, but the tester must verify the exact URL and dedicated test tenant every run because arbitrary DNS aliases cannot be classified reliably.
- Ambiguous requirements remain out of execution until the tester answers and reviews a revised case. The original source file is never edited.
- Assertion mismatches create local bug-draft candidates with expected/observed behavior and sanitized browser evidence. Severity is a host-agent proposal; the tester confirms before sharing.
- `.tirai/workflow/runs/` stores per-run spec/case snapshots, JSON/Markdown reports, and sanitized evidence. `.tirai/workflow/runtime/` holds temporary or imported sessions and is gitignored. Imported sessions remain until `tirai auth clear`; treat the source file and stored session as credentials.


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
├── workflow/
│   ├── approvals.json
│   ├── clarifications.json
│   ├── pending-clarifications.json # unresolved Skill questions
│   ├── runtime/          # temporary sessions; gitignored
│   └── runs/             # per-run snapshots, reports, sanitized evidence
├── discovery/
│   └── routes.json
├── sources/              # ingested source snapshot
├── runtime/
├── results/
├── reports/
└── state/
```

---

## 🛡️ Trusted mapping boundary for code generation

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

This rule applies to generated-code workflows: without mappings, TIRAI creates a spec preview rather than executable tests. A trusted `unit.json` mapping binds cases to source symbols; generated Playwright E2E requires reviewed mappings. The separate black-box web-testing runner does not inspect source by default; it uses same-origin route selection, human-approved cases, and runtime UI grounding.

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
tirai target add web <environment> --url <url> [--username-ref env:NAME --password-ref env:NAME]
tirai target validate
tirai web discover --environment local|dev|staging
tirai auth login --environment <env>
tirai auth import --environment <env> --file <storageState.json>
tirai auth clear [--environment <env>]
tirai review clarify --file <json>
tirai review approve --test-case <id> --route </path> --reviewer <name>
tirai artifact import <semantic-ir|requirements|test-plan|testcases|contract> --file <path>

tirai plan [--json]
tirai export --format all|json|xlsx|markdown|pdf|docx [--out <dir>]
tirai execute --platform web --environment <env> --test-case <id> --confirm-dedicated-test-tenant
tirai execute --platform web --environment <env> --test-cases <id,id> --confirm-dedicated-test-tenant
tirai generate --target playwright|vitest [--source-mapping <path>]
tirai run [--json]
tirai report [--json]
tirai status [--json]
```

`tirai run` and `tirai execute` process exit codes:

```text
0 = PASS
1 = business assertion FAIL
2 = BLOCKED / manual / validation / configuration / infrastructure ERROR
```

`tirai report` summarizes both `tirai run` results and `tirai execute` adapter results. For `tirai execute`, use the per-case report and exit code together; API/database preparation-only results exit 2 rather than being reported as passes.

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
│   HOST AGENT ANALYSIS → ARTIFACT IMPORT     │
│ Semantic IR → Requirements → Test plan      │
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
                    (Web UI; API/DB preparation only) (Playwright/Vitest)
```

### Core design principles

```text
Sources describe WHAT should be tested.
The host agent supplies canonical JSON artifacts.
Canonical JSON is intermediate product truth.
Trusted mappings bind truth to the real project.
Deterministic generators create executable tests.
Real runners produce canonical results.
```

### Security model

- TIRAI makes no model calls and stores no model credentials; the host agent supplies artifacts through its own session.
- Generated code and canonical results must not contain raw credentials.
- TIRAI writes managed state under `.tirai/` instead of mutating application source.
- Unit target fingerprints protect against stale symbol mappings.
- Missing authority fails closed.

---

## 🤖 AI boundaries

TIRAI performs zero model calls. Semantic stages run in the host agent and enter TIRAI only as validated artifacts.

| Stage | Runtime authority? |
|---|---:|
| Source understanding | Host agent → `semantic-ir` artifact |
| Requirement/TestCase planning | Host agent → `requirements`/`test-plan`/`testcases` artifacts |
| E2E trusted mapping | Human/project authority (no guessing) |
| Unit target mapping | Exact symbol/fingerprint (no guessing) |
| Playwright generation | Deterministic |
| Vitest generation | Deterministic |
| Test execution | Real runner |
| Result mapping | Deterministic |

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
