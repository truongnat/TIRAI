# TIRAI Testing Harness — Implementation Plan

## Product goal

Build TIRAI as a general-purpose AI testing compiler. A tester provides a
project configuration and one or more specifications; TIRAI analyzes them,
creates a canonical JSON contract, generates selected test artifacts, executes
them when possible, and produces traceable reports.

### Control-plane architecture

TIRAI supports two control planes over the same artifact protocol:

- Standalone CLI: TIRAI orchestrates stages and uses configured API-key,
  local-model, or fake providers for model calls.
- External agent host: Codex, Claude, or another agent orchestrates TIRAI and
  reads/writes raw context, contract, checkpoints, and reports. TIRAI does not
  spawn another agent CLI in this mode.

CLI is the workflow interface, not an AI provider.

```text
Multi-source spec + project context
  -> raw context and chunks
  -> AI analysis and consolidation
  -> canonical Contract IR
  -> artifact plan
  -> Excel / Markdown / Playwright / unit / API / DB tests
  -> execution evidence
  -> traceable report
```

## Current implementation status

- Goal 0 foundation is implemented in the `contract-ir` workspace package.
- `ingest` now persists and validates `.tirai/artifacts/contract.json` beside
  the existing stage artifacts.
- Contract validation covers schema version, unique node IDs, references, and
  quality-count consistency.
- Contract fingerprints are stable across generated metadata such as timestamps.
- Goal 1 foundation is implemented: project profile fields, task registry,
  active task selection, and isolated task directories are available through
  `task create`, `task list`, and `task show`.
- The remaining goals below are roadmap work; the current example still uses
  the legacy stage IRs as the source for the first Contract IR adapter.
- CLI/API-provider separation is explicit: external agents control TIRAI
  through artifacts, while model providers are injectable dependencies.

## Goal 0 — Contract IR as the system of record

### Tasks

- Define a versioned JSON Contract IR schema.
- Model requirements, business flows, UI, API, database, frontend modules,
  state, test scenarios, test data, bindings, artifacts, provenance,
  confidence, unresolved items, and conflicts.
- Define stable IDs and relationships between all domains.
- Add schema validation, fingerprinting, versioning, and migration.
- Require every generated artifact and report to trace back to the contract and
  source location.

### Done when

- The contract has an official JSON Schema.
- The CLI can validate, save, compare, and version contracts.
- Adapters cannot silently invent behavior outside the contract.

## Goal 1 — Project and task workspaces

### Tasks

- Extend `init` with project type, frontend, backend, database, source code,
  environments, AI provider, capabilities, and desired outputs.
- Create independent task workspaces for each specification.
- Track task states: created, ingesting, analyzed, contract-ready, generated,
  executed, and reported.
- Support checkpoint/resume per stage.
- Allow multiple tasks to reuse one project profile.

### Done when

A tester can initialize a project once and then create, analyze, generate,
execute, and report individual tasks without editing internal JSON manually.

## Goal 2 — Multi-source ingestion and raw context

### Tasks

- Support Excel, PDF, DOCX, Markdown, HTML, JSON, CSV, URLs, and source code.
- Preserve file metadata, hashes, pages, sheets, sections, tables, rows,
  columns, ranges, headings, paragraphs, and image references.
- Produce immutable raw artifacts and a chunk manifest.
- Chunk large inputs by module, feature, business flow, API group, entity,
  page, and heading rather than by arbitrary character count.
- Record parent/child relationships and source provenance.

### Done when

An 8,000-line input can be split into reusable module contexts, each with a
stable ID, source location, and content hash.

## Goal 3 — AI orchestration for every semantic stage

### Tasks

- Provide pluggable API-key, local-model, and fake providers for standalone
  CLI runs; external agent hosts control TIRAI through the same artifacts.
- Add stage runners for source understanding, requirement extraction, UI/API/
  data analysis, source analysis, cross-reference, consolidation, test design,
  artifact planning, execution analysis, and reporting.
- Require structured output against schemas.
- Add retries, JSON repair, token budgets, concurrency limits, checkpoints,
  prompt versions, and request metadata.
- Support chat-based refinement of a task and its contract.
- Never replace a required AI semantic stage with hard-coded fixture logic.

### Done when

Each stage has a declared input/output contract, can resume after failure, and
can switch AI providers without changing pipeline behavior.

## Goal 4 — Contract analysis and consolidation

### Tasks

- Extract requirements, flows, acceptance conditions, UI components, API
  request/response/error behavior, entities, fields, constraints, frontend
  modules, state, query keys, and mutations.
- Join information across sources using explicit IDs, routes, endpoints,
  entities, module names, and source locations.
- Detect duplicates, missing details, contradictions, unsupported behavior, and
  unreachable flows.
- Assign confidence and create an unresolved queue for tester confirmation.
- Consolidate all chunks into a versioned Contract IR.

### Done when

A requirement can link to its business flow, UI, API, data, source code, test
cases, and execution evidence.

## Goal 5 — Contract-driven artifact planning

### Tasks

- Define an `ArtifactPlan` and artifact dependency graph.
- Support one or many Markdown files, Excel, Playwright, unit, API, DB, JSON,
  and report outputs.
- Split outputs by module, feature, domain, source size, token budget, or
  configured policy.
- Generate an artifact manifest containing IDs, paths, dependencies, versions,
  fingerprints, and contract references.
- Regenerate one module without overwriting unrelated artifacts.

### Done when

Small tasks can produce one document while large tasks produce organized,
cross-linked module artifacts with a stable index.

## Goal 6 — Complete test design generation

### Tasks

- Expand requirements into appropriate happy, negative, boundary, validation,
  loading, empty, error, security, state-transition, retry, rollback,
  integration, and responsive scenarios.
- Include preconditions, fixtures, data, steps, UI assertions, API assertions,
  state/cache assertions, cleanup, priority, tags, automation status, and
  manual reasons.
- Generate multiple test cases when one business flow contains multiple
  acceptance conditions.
- Keep coverage metrics based on behavior paths, not merely one case per row.

### Done when

Loading, success, empty, error, optimistic-update, rollback, and validation
behaviors are represented as separate testable paths where applicable.

## Goal 7 — Source intelligence and trusted mapping

### Tasks

- Scan routes, components, locators, handlers, API calls, query keys,
  mutations, state, validation, and UI feedback states.
- Build a Source Intelligence IR.
- Map contract elements to source evidence.
- Detect missing implementation, undocumented implementation, API mismatch,
  field mismatch, and missing locators.
- Fail closed for unsafe guessed mappings.
- Keep manual-only cases fully specified even when they cannot yet execute.

### Done when

Generated tests use proven source mappings and every mapping has source
evidence or an explicit unresolved reason.

## Goal 8 — Execution harness

### Tasks

- Provide Playwright, Vitest/Jest, API, and database execution adapters.
- Support environment profiles, browser settings, headers, secrets, timeout,
  retry, and worker configuration.
- Manage fixtures, mocks, recording, seed data, reuse, and cleanup.
- Map runtime results back to contract test cases and evidence.
- Distinguish passed, business failed, infrastructure error, blocked, skipped,
  and manual outcomes.

### Done when

Generated tests can run from the CLI with project-specific configuration and
can be rerun by test case or module without changing the contract.

## Goal 9 — Full output adapters

### Excel sheets

- Contract Summary
- Requirements
- Business Flows
- Scenarios
- Test Cases
- Steps
- Assertions
- Test Data
- API Checks
- UI Checks
- State Checks
- Traceability
- Manual Gaps
- Conflicts
- Execution Results
- Summary

### Markdown

- Produce one file for small contracts.
- Split by module or domain for large contracts.
- Generate an index and cross-links.
- Include contract version, provenance, assumptions, and unresolved items.

### Code outputs

- Generate Playwright, unit, API, and DB tests from the same contract.
- Include contract fingerprint and provenance in generated source metadata.

### Done when

No important contract field is lost during export and all artifacts can be
traced back to their contract nodes.

## Goal 10 — Execution report and feedback loop

### Tasks

- Generate JSON, Markdown, HTML, and Excel reports.
- Report requirement/scenario/automation coverage, unresolved items,
  conflicts, source mismatches, and execution outcomes.
- Link failures to requirement, test case, source location, spec location, and
  execution evidence.
- Support chat questions such as why a test failed, what is uncovered, and
  which fixture is missing.

### Done when

A tester can navigate from a failed result back to the relevant spec, contract
node, generated test, and source code.

## Goal 11 — Tester-friendly CLI and interaction model

### Commands

- `init`
- `task`
- `spec`
- `ingest`
- `analyze`
- `contract`
- `artifact`
- `generate`
- `execute`
- `report`
- `status`

### Tasks

- Add interactive confirmation for unresolved items and conflicts.
- Add chat refinement for requirements and contract nodes.
- Add dry-run and artifact-plan preview.
- Allow output selection through configuration and flags.
- Keep logs understandable to testers rather than exposing internal pipeline
  details only.

## Goal 12 — Quality, security, and production readiness

### Tasks

- Add unit, schema, golden, replay, deterministic-generation, and end-to-end
  tests for every source type and adapter.
- Protect against prompt injection in specifications.
- Scan and redact secrets from artifacts, logs, and AI metadata.
- Enforce file-size, token, timeout, and resource limits.
- Add audit trail, caching, checkpointing, CI, and contract migration tests.

### Done when

The same input, tool version, model version, and configuration can reproduce
the same contract and artifact plan, while all AI and execution decisions are
auditable.

## Delivery milestones

### M0 — Foundation

- Contract IR schema
- Project/task model
- Raw context model
- Artifact manifest
- AI provider interface

### M1 — Multi-source AI analysis

- Excel/PDF/DOCX/Markdown ingestion
- Structural chunking
- AI stage runner
- Requirement and flow extraction
- Contract consolidation

### M2 — Contract-driven test design

- Scenario expansion
- Test data
- Assertions
- Traceability
- Manual gap and conflict handling

### M3 — Artifact generation

- Complete Excel output
- Module-aware Markdown
- Playwright
- Unit/API/DB adapters

### M4 — Execution and reporting

- Browser/unit/API/DB execution
- Fixture lifecycle
- Result mapping
- Traceable reports

### M5 — Productization

- Task workflow
- Chat refinement
- Resume/checkpoint
- CI and security
- Documentation and example projects

## Immediate implementation order in the current repository

1. Replace the hard-coded structured-design compiler with AI-backed stages.
2. Define the Contract IR before adding more prompts.
3. Preserve all Excel sections and join UI/DB/FE/API/business-flow data.
4. Generate behavior-path test cases instead of one test per business-flow row.
5. Add `ArtifactPlan` and manifest support.
6. Expand the Excel exporter without dropping contract detail.
7. Improve source intelligence and trusted bindings.
8. Add execution fixtures and result traceability.
9. Add chat refinement and unresolved-item confirmation.
10. Optimize prompts, model selection, cost, and latency after correctness is
    established.
