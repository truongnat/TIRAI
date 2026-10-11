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
# Initialize in the web app project
tirai init

# Configure ai.provider / ai.model in .tirai/config.json and export the provider key
export GROQ_API_KEY=...

# Ingest a local Excel, Markdown, or HTML specification
tirai ingest ./spec.xlsx
tirai plan

# Configure only a non-production environment
tirai target add web staging --url https://staging.example.com
# Optional environment-secret references; never pass raw credentials:
# tirai target add web staging --url https://staging.example.com --username-ref env:TIRAI_USER --password-ref env:TIRAI_PASSWORD

# Choose one session setup if the target requires SSO:
# Temporary manual session (consumed after execution)
# tirai auth login --environment staging
# Or import a reusable Playwright storageState file:
# tirai auth import --environment staging --file ./storageState.json
# Discover same-origin routes; the Skill guides route and case review
tirai web discover --environment staging
# Execute only tester-approved cases against a dedicated test tenant
tirai execute --platform web --environment staging --test-case TC-001 --confirm-dedicated-test-tenant
tirai report --json
```

The runner is black-box and functional UI only. It accepts local/dev/staging environment labels and blocks production-like hostnames; the tester must still verify the exact URL and dedicated test tenant because arbitrary DNS aliases cannot be classified reliably. Assertion failures create local bug-draft candidates; a tester confirms severity and wording. No tracker integration is included.

Run these commands from the TIRAI checkout root to install the Codex-first Skill:

```bash
mkdir -p "$HOME/.agents/skills/tirai-web-testing"
cp skills/tirai-web-testing/SKILL.md "$HOME/.agents/skills/tirai-web-testing/SKILL.md"
```

## Workspace Layout

```text
.tirai/
  config.json              # AI provider, platform environments, env-secret references
  sources/                 # ingested local specification
  artifacts/               # canonical contract, requirements, test plan, TestCases
  discovery/routes.json    # same-origin route discovery snapshot
  workflow/
    approvals.json         # case fingerprint + approved route + reviewer
    clarifications.json    # tester answers linked to spec fingerprint
    pending-clarifications.json # unresolved Skill questions
    runtime/               # local sessions and AI artifacts; gitignored
    runs/<run-id>/
      snapshot/             # spec, contract, plan, selected cases, approvals
      report.json
      report.md
      evidence/             # sanitized screenshots
  reports/latest-summary.md
  generated/                # optional generated Playwright/Vitest code
  runtime/                  # generated-test runtime copies
  results/                  # generated-test results
  state/workspace.json
  .gitignore
```

Reviewed test plans, approvals, clarification records, run snapshots, reports, and sanitized evidence are commit-friendly. Browser sessions, AI request artifacts, temporary files, and raw logs are gitignored. Imported sessions remain available until `tirai auth clear`; treat the source file and stored session as credentials.

## Configuration

`tirai init` creates `.tirai/config.json` with config version 2 and `ai.provider: "fake"`. Before web execution, set `ai.provider` to a real supported provider (`groq`, `deepseek`, or `cli`) and configure its model/command. Provider credentials stay in environment variables (`GROQ_API_KEY`, `DEEPSEEK_API_KEY`); raw keys never belong in config or test cases. Web execution rejects `fake`.

Configure web targets with `tirai target add web <environment> --url <url>`. Optional username/password/token inputs are `env:NAME` references. `local`, `dev`, `development`, or `staging` are the only accepted web environment names; `local` must use localhost. Every run also requires `--confirm-dedicated-test-tenant`.

Source inspection is opt-in: `tirai ingest <spec> --source-code <dir>` reads that application directory without modifying it. Default ingestion is black-box and reads only the specification.

## Run Status

`tirai execute --platform web` writes per-run `report.json` and `report.md` under `.tirai/workflow/runs/<run-id>/`. Assertion mismatches appear as `failed`/`partial`; infrastructure or safety stops appear as `error`/`blocked`. `tirai report --json` reads the latest web run.

Generated-code `tirai run` exit codes: `0` all passed, `1` business assertion failure, `2` blocked/configuration/validation/infrastructure error. Empty runs are errors, not passes.

## Commands

- `tirai init [--force]` — create `.tirai/`.
- `tirai ingest <spec>` — ingest local specs; optional `--source-code <dir>` is a separate, explicit read-only opt-in.
- `tirai target add web <environment> --url <url> [--username-ref env:NAME --password-ref env:NAME]` — configure a web target.
- `tirai web discover --environment <name>` — discover same-origin routes and safe menus/tabs without submitting forms.
- `tirai auth login --environment <name>` — create a temporary headed SSO session, consumed after execution.
- `tirai auth import --environment <name> --file <storageState.json>` — import the output of Playwright `browserContext.storageState({ path })` for reuse; kept until cleared.
- `tirai auth clear [--environment <name>]` — remove temporary and imported browser sessions.
- `tirai review clarify --file <json>` — store a tester answer and a revised case while preserving source requirement links.
- `tirai review approve --test-case <id> --route </path> --reviewer <name>` — record human approval.
- `tirai execute --platform web --environment <name> --test-case <id> --confirm-dedicated-test-tenant` — run selected approved cases.
- `tirai report [--json]` — show the latest web report or canonical generated-test summary.
- `tirai generate [--e2e|--unit]` / `tirai run` — optional developer code-generation path.

The Codex-first Skill coordinates clarification, human review, route/case selection, and bug-draft confirmation. Confluence, API, visual, accessibility, and performance testing are outside web-testing v1.

## Notes

- Web execution uses real Chromium and an AI provider; assertion mismatches are never retried.
- A transient browser/network infrastructure failure is retried once. Assertion mismatches do not stop independent cases; unsafe environment or cleanup failures do.
- `execution-mapping-builder` remains for generated-code workflows; black-box web execution does not require source-derived selectors.
