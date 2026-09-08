# TIRAI v1 — Spec-First, Platform-Aware Test Orchestration & Multi-Output Plan

**Status:** Implementation plan

**Audience:** Subagent / implementation agent

**Product:** TIRAI — AI-driven Test Orchestration Platform

**Primary decision:** TIRAI v1 must be able to generate correct canonical test cases from specifications and platform/environment configuration without requiring source code, source repository, selectors, method mappings, or automation scripts.

---

## 1. Executive Summary

The current v1 direction is incorrect because it treats source-code-bound Vitest generation as the primary product path. That violates the intended product model.

TIRAI is a black-box, specification-first test orchestration platform. The user should provide:

1. The platforms and application targets that need to be tested.
2. The environment and access configuration for each target.
3. The business/technical specifications.
4. Optional credentials, API access, database access, app artifacts, and test data references.

TIRAI then produces canonical requirements, scenarios, test plans, and test cases. These canonical artifacts can be exported to multiple formats or passed to optional execution providers.

The canonical TestCase/TestPlan JSON is the source of truth and intermediate product contract. It is not the final user-facing output by itself.

The target architecture is:

```text
Project Initialization
        ↓
Platform and Environment Configuration
        ↓
Specification Ingestion
        ↓
Semantic Understanding
        ↓
Requirement IR
        ↓
Scenario IR
        ↓
Canonical TestCase / TestPlan IR
        ├── JSON output
        ├── Excel output
        ├── PDF output
        ├── Word output
        ├── Markdown output
        ├── Playwright E2E artifact
        ├── Vitest unit artifact (optional white-box mode)
        └── Agent execution plan
                                  ↓
                         Optional execution
                                  ↓
                         Result IR + evidence
```

Generation, export, and execution must be separate operations.

---

## 2. Product Decisions That Are Not Negotiable

### 2.1 Source code is optional

Source code must not be required for:

- `tirai init`;
- specification ingestion;
- requirement generation;
- scenario generation;
- test-case generation;
- Excel/PDF/Word/Markdown/JSON export;
- black-box Web testing;
- black-box Mobile testing;
- API testing;
- database verification planning.

Source code may be accepted later as optional evidence for white-box analysis or explicit unit-test generation. It must not become a hidden prerequisite for the core flow.

### 2.2 TestCase is a test intent, not framework code

The canonical TestCase must describe:

- what should be tested;
- why it should be tested;
- which platform and environment it targets;
- required inputs and data;
- actions at intent level;
- expected outcomes;
- verification strategy;
- evidence requirements;
- provenance back to the specification.

It must not be coupled to Playwright, Vitest, Selenium, Appium, SQL, or any other framework.

### 2.3 JSON is canonical, not the only output

The canonical JSON is the machine-readable source of truth. Users must be able to export the same TestCase/TestPlan data to:

- Excel;
- PDF;
- Word/DOCX;
- Markdown;
- JSON/API;
- executable test artifacts where supported.

An export failure must not mutate or corrupt the canonical test truth.

### 2.4 Execution is optional

Users may only want to review or deliver test cases. Therefore:

- exporting to Excel must not require executing tests;
- exporting to PDF must not require executing tests;
- exporting to Word must not require executing tests;
- exporting canonical JSON must not require executing tests;
- generating an executable artifact must not automatically execute it;
- execution must be an explicit command.

### 2.5 No fake tests

The current standalone `spec-unit` approach is invalid as a product test path because it creates a table from the same expected values and then verifies that table against itself. It does not call application code and can report PASS while the application is broken.

That behavior must be removed from the default path or explicitly renamed as a non-test preview artifact. It must never be presented as a real unit test or real application verification.

---

## 3. Target User Flow

### 3.1 Initialize a project

The user starts with:

```bash
tirai init
```

The initializer must ask for or accept configuration for one or more target platforms:

- Web;
- Mobile;
- Backend/API;
- Database.

The user may configure multiple environments per platform, for example:

- local;
- development;
- staging;
- production.

The initializer must not ask for a source repository as a mandatory step.

### 3.2 Add specifications

The user provides one or more specifications:

```bash
tirai spec add ./docs/order-flow.xlsx
tirai spec add ./docs/payment-rules.docx
tirai spec add ./docs/api-contract.md
```

Supported source formats may include Excel, PDF, DOCX, Markdown, CSV, JSON, and URL/HTML according to existing connector support.

Each imported specification must retain provenance:

- source file or URL;
- source revision/fingerprint;
- page, sheet, section, or cell location when available;
- ingestion timestamp;
- connector and connector version.

### 3.3 Generate the canonical test plan

```bash
tirai plan
```

The AI uses both:

- specification content;
- configured platforms/environments/capabilities.

The result is:

- Requirement IR;
- Scenario IR;
- TestCase IR;
- TestPlan IR;
- unresolved questions/data needs;
- warnings and confidence;
- complete provenance.

### 3.4 Review and resolve missing inputs

If the specification says “user logs in” but no test user is configured, TIRAI must not silently invent one. It should report a missing data need such as:

```text
Missing input:
- platform: web
- environment: staging
- requirement: user login
- needed: test account email and password
- source: OrderFlow.xlsx / sheet Login / row 12
```

The user can then add a safe secret reference or test-data fixture and regenerate.

### 3.5 Export or execute

The user can choose one or more outputs:

```bash
tirai export --format xlsx
tirai export --format pdf
tirai export --format docx
tirai export --format markdown
tirai export --format json
```

Or choose an executable/agent target:

```bash
tirai generate --target playwright --mode e2e
tirai generate --target vitest --mode unit --source-mapping ./mapping.json
tirai execute --platform web --environment staging
```

Generation and export do not execute tests. Execution is explicit.

---

## 4. Project Configuration Model

The project configuration must be platform-aware and environment-aware.

Recommended file:

```text
.tirai/config.json
```

Secrets must never be written as plaintext into this file. Store references such as `env:NAME` or a configured secret-manager reference.

### 4.1 Example project configuration

```json
{
  "schemaVersion": "1.0",
  "project": {
    "name": "order-platform",
    "defaultEnvironment": "staging",
    "defaultLanguage": "en"
  },
  "platforms": {
    "web": {
      "enabled": true,
      "environments": {
        "local": {
          "baseUrl": "http://localhost:3000"
        },
        "staging": {
          "baseUrl": "https://staging.example.com",
          "credentials": {
            "usernameRef": "env:TIRAI_WEB_USERNAME",
            "passwordRef": "env:TIRAI_WEB_PASSWORD"
          }
        }
      },
      "capabilities": {
        "browser": "chromium",
        "screenshots": true,
        "traces": true,
        "networkCapture": true,
        "consoleCapture": true
      }
    },
    "backend": {
      "enabled": true,
      "environments": {
        "staging": {
          "baseUrl": "https://api-staging.example.com",
          "auth": {
            "type": "bearer",
            "tokenRef": "env:TIRAI_API_TOKEN"
          }
        }
      },
      "contractRefs": [
        "./contracts/openapi.yaml"
      ]
    },
    "mobile": {
      "enabled": true,
      "targets": [
        {
          "platform": "android",
          "packageName": "com.example.order",
          "appArtifactRef": "env:TIRAI_ANDROID_APK",
          "deviceProfile": "android-emulator-api-35"
        },
        {
          "platform": "ios",
          "bundleId": "com.example.order",
          "appArtifactRef": "env:TIRAI_IOS_APP",
          "deviceProfile": "ios-simulator"
        }
      ]
    },
    "database": {
      "enabled": true,
      "environments": {
        "staging": {
          "type": "postgres",
          "connectionRef": "env:TIRAI_DATABASE_URL",
          "schema": "tenant1",
          "readOnly": true
        }
      }
    }
  }
}
```

### 4.2 Web configuration

Required:

- platform enabled flag;
- one or more environments;
- base URL per environment.

Optional:

- authentication mechanism;
- credential references;
- browser choice;
- viewport/device profile;
- browser storage state reference;
- headers;
- proxy;
- screenshot/trace/network/console capabilities.

The TestCase must reference the logical environment, not hard-code environment URLs inside business logic.

### 4.3 Backend/API configuration

Required:

- API base URL per environment;
- authentication reference where needed.

Optional:

- OpenAPI/Swagger contract;
- GraphQL schema;
- common headers;
- request signing configuration;
- rate-limit policy;
- test tenant or organization context.

The AI may use an API contract to improve test planning, but the contract is not a replacement for business specification.

### 4.4 Mobile configuration

The package name or bundle ID identifies the application but is not by itself enough to execute a test. For execution, the system may also need:

- Android package name or iOS bundle ID;
- platform;
- APK/AAB/IPA/app artifact reference;
- emulator/simulator/device profile;
- install strategy;
- optional deep-link scheme;
- optional backend environment binding.

For planning and export, package name/bundle ID plus platform can be sufficient. For execution, the missing runtime artifact/device information must be surfaced as a capability/data requirement.

### 4.5 Database configuration

Required:

- database type;
- environment;
- connection reference;
- read-only/write capability;
- schema or namespace where relevant.

Optional:

- allowed tables/views;
- tenant schema;
- migration/version metadata;
- data cleanup strategy;
- query policy.

Database credentials must be read from environment/secret references. Raw credentials must never appear in canonical IR, generated artifacts, logs, or reports.

---

## 5. Specification Input Model

Specifications and target configuration are separate inputs but must be resolved together during planning.

### 5.1 Specification metadata

Every specification document should have:

```json
{
  "id": "spec-order-flow-001",
  "name": "Order Flow Specification",
  "sourceType": "xlsx",
  "sourceRef": "./docs/order-flow.xlsx",
  "revisionFingerprint": "sha256:...",
  "language": "en",
  "domain": "order-management",
  "priority": "primary"
}
```

### 5.2 Multiple specifications

The planner must support multiple documents and detect:

- duplicated requirements;
- conflicting rules;
- missing references;
- version differences;
- platform-specific rules;
- environment-specific rules.

Conflicting specifications must produce a visible conflict record. The AI must not silently choose one authority.

### 5.3 Input completeness gate

Before generating final TestCases, TIRAI must validate:

- at least one specification exists;
- the target platform is known for each scenario;
- required environment exists;
- required credentials/data are either available or explicitly unresolved;
- expected outcomes are sufficiently defined;
- cross-document references are resolvable or marked unresolved.

The planner may produce a draft plan with unresolved items, but it must distinguish:

- `ready`;
- `needs-input`;
- `ambiguous`;
- `conflicted`;
- `manual-review`.

---

## 6. Canonical IR Contracts

The canonical IR must remain source-, provider-, execution-, and output-agnostic.

### 6.1 Required IR layers

Implement or preserve these logical layers:

1. `SpecificationDocumentIR`
2. `RequirementIR`
3. `ScenarioIR`
4. `TestCaseIR`
5. `TestPlanIR`
6. `OutputArtifactIR`
7. `TestRunResultIR`

### 6.2 TestCaseIR minimum shape

```json
{
  "schemaVersion": "1.0",
  "id": "TC-ORDER-LOGIN-001",
  "requirementIds": ["REQ-ORDER-001"],
  "scenarioId": "SC-ORDER-LOGIN",
  "title": "User can log in and access the order dashboard",
  "objective": "Verify successful login for an active user",
  "platform": {
    "type": "web",
    "environment": "staging",
    "targetRef": "web.staging"
  },
  "executionIntent": {
    "mode": "black-box-agent",
    "preferredCapabilities": ["browser", "screenshot", "network"]
  },
  "preconditions": [
    "A valid active test user exists"
  ],
  "inputs": [
    {
      "name": "email",
      "valueRef": "secret:TEST_USER_EMAIL",
      "sensitivity": "secret"
    },
    {
      "name": "password",
      "valueRef": "secret:TEST_USER_PASSWORD",
      "sensitivity": "secret"
    }
  ],
  "steps": [
    {
      "order": 1,
      "intent": "Open the login page"
    },
    {
      "order": 2,
      "intent": "Enter the configured test user credentials"
    },
    {
      "order": 3,
      "intent": "Submit the login form"
    }
  ],
  "expectedResults": [
    {
      "kind": "navigation",
      "description": "The user is redirected to the order dashboard"
    },
    {
      "kind": "state",
      "description": "The authenticated user identity is visible"
    }
  ],
  "dataNeeds": [],
  "evidenceRequirements": [
    "screenshot",
    "finalUrl",
    "networkSummary"
  ],
  "automation": {
    "status": "ready",
    "reasons": []
  },
  "provenance": [
    {
      "sourceId": "spec-order-flow-001",
      "location": "Login sheet / row 12",
      "excerptHash": "sha256:..."
    }
  ],
  "confidence": 0.94
}
```

### 6.3 Platform-specific details belong in capability/adapter data

Do not add Playwright-specific selectors, Vitest-specific imports, SQL implementation details, or Appium commands directly into the canonical TestCase.

Platform/executor adapters may derive their own execution plan from the canonical intent:

```text
Canonical TestCase
        ↓
Web Agent Adapter / API Adapter / Mobile Adapter / DB Adapter
        ↓
Executor-specific plan
```

---

## 7. AI Planning and TestCase Generation

The AI planner must receive a structured context containing:

- all selected specifications;
- platform configuration;
- environment configuration;
- available capabilities;
- credential/data references without secret values;
- optional API contracts;
- optional database schema metadata;
- optional app metadata;
- requested coverage level;
- user language and output preferences.

### 7.1 Platform-aware planning rules

The planner must decide or ask for:

- which platform a scenario belongs to;
- whether a scenario is Web, Mobile, Backend, DB, or cross-platform;
- whether the scenario requires one executor or a sequence of executors;
- which environment is relevant;
- which data and credentials are required;
- which verification source is authoritative.

Example:

```text
Create order
  Web: submit the order through UI
  Backend: verify order API response
  DB: verify persisted order status
```

This may become one end-to-end scenario with multiple execution steps or multiple linked TestCases. The linkage must remain explicit.

### 7.2 Do not invent target details

The AI must not invent:

- URLs;
- API paths;
- package names;
- database tables;
- selectors;
- credentials;
- expected values not supported by the specification;
- source symbols.

If the input is missing or ambiguous, emit a data need/question and mark the affected TestCase accordingly.

### 7.3 Expected-result requirement

A TestCase must not become executable or be marked ready solely because it has a human-readable description. An explicit expected outcome, observable oracle, or manual-review instruction is required.

Do not use a generic expected-result description as a substitute for a missing expected value.

---

## 8. Output and Export Architecture

Introduce an explicit output connector boundary.

```ts
interface TestOutputExporter<TOptions = unknown> {
  readonly format: string;
  export(input: {
    testPlan: TestPlanIR;
    testCases: TestCaseIR[];
    options?: TOptions;
  }): Promise<OutputArtifactIR>;
}
```

### 8.1 OutputArtifactIR

Every generated artifact should record:

```json
{
  "artifactId": "artifact-...",
  "format": "xlsx",
  "kind": "test-case-export",
  "path": ".tirai/outputs/test-cases.xlsx",
  "testPlanFingerprint": "sha256:...",
  "testCaseIds": ["TC-ORDER-LOGIN-001"],
  "createdAt": "2026-09-08T00:00:00Z",
  "generatorVersion": "...",
  "status": "created"
}
```

### 8.2 Required exporters for v1

#### JSON

Purpose:

- canonical machine-readable output;
- integration with other systems;
- backup and reproducibility.

Outputs:

- `test-plan.json`;
- `requirements.json`;
- `scenarios.json`;
- `testcases.json`;
- optional combined package.

#### Excel

Minimum sheets:

- `Test Cases`;
- `Steps`;
- `Expected Results`;
- `Data Needs`;
- `Traceability`;
- `Summary`.

The Excel export must preserve:

- TestCase ID;
- requirement/scenario linkage;
- platform/environment;
- preconditions;
- steps;
- expected results;
- automation status;
- provenance;
- unresolved questions.

#### PDF

Minimum sections:

- project metadata;
- target platforms/environments;
- scope and coverage summary;
- test cases;
- data requirements;
- traceability;
- unresolved items;
- generation metadata.

#### Word/DOCX

The DOCX export should be editable and contain the same semantic information as the PDF, using stable headings, tables, and test-case sections.

#### Markdown

Useful for code review and Git-based workflows. Include a readable table plus detailed sections for each TestCase.

### 8.3 Export behavior

Export commands must:

- read canonical IR;
- never re-run AI unnecessarily;
- never execute tests;
- never modify business test truth;
- produce deterministic output for the same IR and exporter version;
- record an OutputArtifactIR;
- fail clearly if the selected format is unavailable;
- preserve unresolved/blocked statuses instead of hiding them.

### 8.4 Output commands

Recommended command surface:

```bash
tirai export --format json
tirai export --format xlsx
tirai export --format pdf
tirai export --format docx
tirai export --format markdown
tirai export --format all
```

Common options:

```bash
tirai export --format xlsx --out ./artifacts/test-cases.xlsx
tirai export --format pdf --environment staging
tirai export --format docx --language vi
tirai export --format all --include-blocked
```

---

## 9. Executable Outputs and Execution

Executable artifacts are optional output adapters, not the canonical product model.

### 9.1 Agentic black-box execution

The primary v1 execution direction should support intent-driven execution against configured targets:

- Web agent observes the real application and performs intent-level actions;
- Mobile agent observes and interacts with the real application;
- API executor sends requests based on TestCase intent and API configuration;
- DB executor performs allowed verification queries against configured databases.

The executor must produce normalized Result IR with:

- status: `passed`, `failed`, `blocked`, or `error`;
- step results;
- assertions;
- evidence;
- logs;
- environment and target metadata;
- TestCase traceability;
- failure reason.

### 9.2 Playwright E2E output

Playwright E2E may be provided as an optional executable artifact or adapter. It must not force the canonical TestCase to contain selectors or Playwright syntax.

If Playwright code generation requires source/UI mappings, those mappings are executor-specific and optional. Without mappings, the system should use the agentic/browser execution path or mark code generation as unavailable, not invent selectors.

### 9.3 Vitest unit output

Vitest unit generation is an explicit white-box capability. It requires a real source target and trusted mapping. It must not be the default v1 path.

Requirements:

- no source mapping means `not-available` or `blocked` for Vitest output;
- never generate a fake self-referential test;
- never report a self-referential artifact as application validation;
- source code and mapping remain optional product inputs;
- canonical TestCase stays framework-neutral.

### 9.4 Execution command separation

```bash
tirai generate --target playwright --mode e2e
tirai generate --target vitest --mode unit --source-mapping ./mapping.json
tirai execute --platform web --environment staging
tirai execute --platform backend --environment staging
tirai execute --platform database --environment staging
tirai report
```

The user can export documentation without running any of these commands.

---

## 10. Recommended CLI Surface

### Project and target configuration

```bash
tirai init
tirai target list
tirai target add web --environment staging --url https://staging.example.com
tirai target add backend --environment staging --url https://api-staging.example.com
tirai target add mobile --platform android --package com.example.app
tirai target add database --type postgres --connection-ref env:TIRAI_DATABASE_URL
tirai target validate
```

### Specification management

```bash
tirai spec add ./spec.xlsx
tirai spec list
tirai spec inspect
```

### Planning

```bash
tirai plan
tirai plan --platform web
tirai plan --platform backend
tirai plan --environment staging
tirai plan --json
tirai status
```

### Export

```bash
tirai export --format json
tirai export --format xlsx
tirai export --format pdf
tirai export --format docx
tirai export --format markdown
tirai export --format all
```

### Optional generation/execution

```bash
tirai generate --target playwright --mode e2e
tirai generate --target vitest --mode unit --source-mapping ./mapping.json
tirai execute --platform web --environment staging
tirai report
```

The exact command names may follow existing CLI conventions, but the semantic separation is mandatory.

---

## 11. Workspace Layout

Recommended `.tirai` layout:

```text
.tirai/
├── config.json
├── project.json
├── specs/
│   ├── index.json
│   └── sources/
├── artifacts/
│   ├── specification-ir.json
│   ├── requirements.json
│   ├── scenarios.json
│   ├── testcases.json
│   └── test-plan.json
├── outputs/
│   ├── json/
│   ├── excel/
│   ├── pdf/
│   ├── docx/
│   ├── markdown/
│   └── executable/
├── mappings/
│   └── optional-white-box/
├── runtime/
├── results/
├── reports/
└── state/
```

The canonical artifacts must be separate from generated output artifacts. An exporter must never overwrite `artifacts/testcases.json` with format-specific data.

---

## 12. Architecture Changes Required in the Current Repository

The implementation agent must inspect the repository and refactor according to the following boundaries.

### 12.1 Keep and reuse

- source connectors;
- canonical specification/context extraction;
- semantic analysis;
- requirement/scenario/test-case IR models;
- provenance and fingerprinting;
- deterministic result contracts;
- existing real executors where they are valid.

### 12.2 Change

- make `init` collect platform/environment target configuration;
- add a target configuration model and validation layer;
- make planning consume both specification IR and target profile IR;
- make TestCase generation platform-aware but framework-neutral;
- add output exporter interfaces and implementations;
- add export CLI commands;
- separate canonical artifacts from output artifacts;
- make execution optional;
- surface missing data/capability requirements;
- add traceability from every export back to TestCase IDs and source provenance.

### 12.3 Remove from the default flow

- mandatory source repository inspection during normal planning;
- mandatory `unit.json` mapping for TestCase generation;
- mandatory source symbols for TestCase generation;
- fake standalone spec-unit tests;
- claims that generated spec-table tests validate the application;
- coupling canonical TestCase fields to Playwright/Vitest implementation details.

### 12.4 Preserve as optional capability

The existing source-aware unit generator may remain behind an explicit white-box mode if it is correct and tested:

```text
white-box unit mode = source project + trusted mapping + real function invocation
```

It must not block black-box planning, export, or agent execution.

---

## 13. Validation and Error Semantics

Use explicit statuses throughout planning, export, and execution.

### Planning statuses

- `ready`;
- `needs-input`;
- `ambiguous`;
- `conflicted`;
- `manual-review`.

### Export statuses

- `created`;
- `partial`;
- `failed`.

An export should still include blocked or unresolved TestCases when requested, clearly labeled. It must not silently remove them.

### Execution statuses

- `passed`;
- `failed`;
- `blocked`;
- `error`.

`0 tests discovered` must be `error`, never `passed`.

---

## 14. Testing Requirements

### 14.1 Initialization tests

Verify:

- initialize with Web only;
- initialize with Backend only;
- initialize with Mobile only;
- initialize with Database only;
- initialize with multiple platforms;
- configure multiple environments;
- validate missing required target fields;
- secrets are stored only as references;
- no source repository is required.

### 14.2 Planning tests

Verify:

- specification plus Web target produces Web-oriented TestCases;
- specification plus Backend target produces API-oriented TestCases;
- specification plus Mobile target produces Mobile-oriented TestCases;
- specification plus DB target produces database verification requirements;
- cross-platform flows retain links between related TestCases;
- missing credentials become data needs;
- missing URL/package/database config becomes a clear unresolved item;
- conflicting specifications are surfaced;
- provenance is preserved;
- AI does not invent URLs, credentials, selectors, tables, package names, or source symbols.

### 14.3 Export tests

For the same canonical TestPlan, verify:

- JSON export is valid and deterministic;
- Excel contains required sheets and fields;
- PDF renders and contains all required sections;
- DOCX opens and contains stable headings/tables;
- Markdown is readable and traceable;
- `--format all` creates all enabled outputs;
- export does not execute tests;
- export failure does not mutate canonical JSON;
- exported TestCase IDs map one-to-one back to canonical IR.

### 14.4 Execution tests

Verify:

- execution is not invoked by export commands;
- Web agent/executor consumes Web target config;
- API executor consumes Backend target config;
- DB executor respects read-only policy;
- Mobile executor validates package/artifact/device capabilities;
- Result IR preserves TestCase and provenance links;
- no source code is required for black-box execution;
- Vitest output is blocked/unavailable without real source mapping;
- no fake spec-table test can be reported as application validation.

### 14.5 End-to-end acceptance scenario

Create a temporary project with:

1. Web staging URL configuration.
2. Backend staging API URL.
3. Read-only database reference.
4. Mobile package name and optional artifact reference.
5. One business specification covering login and order creation.

Run:

```bash
tirai init
tirai spec add ./order-spec.xlsx
tirai plan
tirai export --format all
tirai status
```

Acceptance:

- canonical TestCases are generated;
- platform/environment is present on each applicable TestCase;
- missing runtime inputs are explicit;
- JSON, Excel, PDF, DOCX, and Markdown outputs are created;
- no source repository is required;
- no test execution is required to create exports;
- no fake unit test is created;
- all outputs trace back to canonical TestCase IDs.

---

## 15. Implementation Phases

### Phase 1 — Correct the product boundary

- Document source-optional black-box behavior.
- Separate planning from source inspection.
- Remove fake standalone unit tests from the default path.
- Make missing source mapping an optional-executor condition, not a planning failure.
- Update README and CLI help so they no longer imply source mapping is required for normal TestCase generation.

### Phase 2 — Platform target configuration

- Add target/platform/environment IR.
- Add config schema and loader.
- Add secret-reference validation.
- Add `tirai target` commands or equivalent interactive init flow.
- Add platform capability model.
- Add config tests.

### Phase 3 — Specification-to-TestCase planning

- Make planner consume specifications plus target profiles.
- Add platform classification and cross-platform linkage.
- Add data-needs and unresolved-input model.
- Add conflict handling and provenance.
- Add planning acceptance tests.

### Phase 4 — Canonical artifact persistence

- Persist Requirement IR, Scenario IR, TestCase IR, and TestPlan IR separately.
- Add stable fingerprints and generation metadata.
- Add status commands for artifacts and unresolved inputs.
- Ensure canonical artifacts are not overwritten by exporters.

### Phase 5 — Export layer

- Add `OutputArtifactIR`.
- Add exporter interface/registry.
- Implement JSON exporter.
- Implement Excel exporter.
- Implement Markdown exporter.
- Implement PDF exporter.
- Implement DOCX exporter.
- Add deterministic/export integrity tests.

### Phase 6 — Optional executors

- Integrate Web black-box/agent executor.
- Integrate Backend/API executor.
- Integrate Database verification executor.
- Integrate Mobile executor capability checks.
- Preserve Result IR and evidence model.
- Keep execution separate from export.

### Phase 7 — Optional white-box output

- Keep or rework Playwright/Vitest generators only as explicit adapters.
- Require real mapping/source evidence for Vitest.
- Never use self-referential spec-table tests.
- Clearly label generated code as an output artifact, not canonical truth.

### Phase 8 — Documentation and release acceptance

- Update README, CLI help, examples, and installation docs.
- Add a full black-box demo without source code.
- Add a full export demo.
- Run all acceptance tests.
- Ensure release packaging contains the corrected implementation.

---

## 16. Suggested Commit/Review Boundaries

Implement in reviewable groups:

1. `feat(core): add platform and target configuration IR`
2. `feat(cli): make init platform-aware and source-optional`
3. `feat(planner): generate platform-aware canonical test cases`
4. `refactor(cli): separate canonical artifacts from generated outputs`
5. `feat(export): add JSON and Markdown exporters`
6. `feat(export): add Excel exporter`
7. `feat(export): add PDF and DOCX exporters`
8. `refactor(execution): make executors consume target profiles`
9. `fix(unit): remove fake standalone spec-unit path`
10. `test(acceptance): add source-free plan and multi-output flow`
11. `docs(product): update v1 architecture and CLI workflow`

Each commit should keep the repository buildable and tests passing. Do not combine exporter implementation with unrelated executor rewrites unless the dependency boundary requires it.

---

## 17. Definition of Done

The implementation is complete only when all statements below are true:

- [ ] `tirai init` does not require source code or a source repository.
- [ ] `tirai init` supports Web, Mobile, Backend, and Database targets.
- [ ] Each platform supports target-specific configuration.
- [ ] Multiple environments are supported.
- [ ] Secrets are references, not plaintext configuration values.
- [ ] Specifications can be added independently of source code.
- [ ] AI planning consumes both specifications and target configuration.
- [ ] Canonical TestCases are framework-neutral.
- [ ] Missing input/capability is explicit and traceable.
- [ ] Canonical TestCase JSON is persisted as source of truth.
- [ ] JSON export is available.
- [ ] Excel export is available.
- [ ] PDF export is available.
- [ ] DOCX/Word export is available.
- [ ] Markdown export is available.
- [ ] Export does not require test execution.
- [ ] Output artifacts contain traceability metadata.
- [ ] Playwright/Vitest are optional output adapters.
- [ ] Vitest is not generated without real source mapping.
- [ ] The fake self-referential standalone unit test is removed from the default flow.
- [ ] Black-box execution does not require source code.
- [ ] Result IR is separate from TestCase/TestPlan IR.
- [ ] A full source-free end-to-end acceptance test passes.
- [ ] Documentation describes the corrected flow.

---

## 18. Direct Instructions for the Implementation Subagent

Read this file as the product contract for the next implementation phase.

Before editing code:

1. Audit the current repository and map existing modules to the boundaries above.
2. Identify which current behavior assumes source code or `unit.json`.
3. Identify the existing canonical IR contracts and preserve them where valid.
4. Produce a gap report and implementation checklist.
5. Do not delete existing modules without proving they are obsolete.
6. Do not implement fake tests to satisfy acceptance counts.

While implementing:

1. Keep canonical TestCase/TestPlan independent of output frameworks.
2. Keep platform configuration independent of exporter implementation.
3. Keep exporter implementation independent of execution.
4. Keep source-aware unit generation optional.
5. Add tests for each new contract before declaring the phase complete.
6. Use explicit statuses for unresolved, blocked, unavailable, failed, and successful work.
7. Preserve provenance and traceability in every artifact.
8. Never expose secrets in JSON, logs, exports, generated code, or reports.

Before declaring completion:

1. Run the source-free planning acceptance flow.
2. Verify all requested exporters.
3. Verify that export commands do not execute tests.
4. Verify that no fake standalone unit test is generated.
5. Verify that current documentation matches the actual CLI behavior.
6. Report remaining limitations instead of marking unsupported capabilities as complete.

The final implementation must make TIRAI useful even when the user has only specifications and target access information, with source code remaining optional.

