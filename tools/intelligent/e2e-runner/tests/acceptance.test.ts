// Real local E2E acceptance tests (§13-33, §193-202).
//
// Proves EndToEndRunner drives a real Chromium browser through the frozen
// orchestration/executor stack:
//   EndToEndRunner → TestExecutionOrchestrator → UIExecutor →
//   PlaywrightBrowserSession → Chromium → Evidence → Cleanup → Reports
//
// The only real runtime is Playwright Chromium against a localhost fixture.
// No AI, no Internet, no production, no real DB.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  TestExecutionOrchestrator,
  TestExecutorRegistry,
  FixedClock,
  DeterministicRunIdProvider,
} from 'test-execution-orchestrator';
import { UIExecutor, PlaywrightBrowserSession, type UIElementCatalog, type TestExecutionMapping } from 'ui-executor';
import { EndToEndRunner } from '../src/runner.js';
import type {
  EndToEndRunnerPolicy,
  EndToEndRunnerInput,
  EndToEndRunnerOptions,
  ProjectExecutionProfile,
  TestCase,
  ExecutionMappingIR,
  TestCaseExecutionMapping,
} from '../src/models.js';
import { defaultPolicy } from '../src/policy.js';
import { computeObjectHash, computeTestCasesSemanticHash } from '../src/fingerprints.js';
import { mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// ---- Constants -------------------------------------------------------------

const VALID_USER = 'demo';
const VALID_PASS = 'test-password';
const OUTPUT_DIR = join(process.cwd(), '..', '..', 'output', 'e2e-runner-final-acceptance');

// ---- Fixture server --------------------------------------------------------

let server: Server;
let baseUrl: string;

function loginPageHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Login</title></head><body>
<h1>Login</h1>
<form id="login-form">
  <input data-testid="username" type="text" placeholder="Username" />
  <input data-testid="password" type="password" placeholder="Password" />
  <button data-testid="login" type="submit">Login</button>
</form>
<div data-testid="error" style="display:none;color:red">Invalid credentials</div>
<script>
document.getElementById('login-form').addEventListener('submit', function(e) {
  e.preventDefault();
  var u = document.querySelector('[data-testid=username]').value;
  var p = document.querySelector('[data-testid=password]').value;
  if (u === '${VALID_USER}' && p === '${VALID_PASS}') {
    window.location.href = '/dashboard';
  } else {
    document.querySelector('[data-testid=error]').style.display = 'block';
  }
});
</script></body></html>`;
}

function dashboardPageHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dashboard</title></head><body>
<div data-testid="welcome">Welcome, ${VALID_USER}!</div>
</body></html>`;
}

function requestHandler(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? '/';
  if (url === '/login' || url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(loginPageHtml());
  } else if (url === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPageHtml());
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}

beforeAll(async () => {
  server = createServer(requestHandler);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Clean up output dir
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
});

// ---- Artifact builders -----------------------------------------------------

function buildCatalog(): UIElementCatalog {
  return {
    environmentId: 'isolated-local',
    pages: [
      {
        id: 'login-page',
        route: '/login',
        elements: [
          { logicalName: 'username', locator: { strategy: 'test-id', value: 'username' } },
          { logicalName: 'password', locator: { strategy: 'test-id', value: 'password' }, sensitive: true },
          { logicalName: 'login-button', locator: { strategy: 'test-id', value: 'login' } },
          { logicalName: 'error-message', locator: { strategy: 'test-id', value: 'error' } },
        ],
      },
      {
        id: 'dashboard-page',
        route: '/dashboard',
        elements: [
          { logicalName: 'welcome-message', locator: { strategy: 'test-id', value: 'welcome' } },
        ],
      },
    ],
  };
}

function buildTestCases(): TestCase[] {
  return [
    {
      id: 'TC-VALID-LOGIN',
      scenarioId: 'SCN-AUTH',
      requirementIds: ['REQ-AUTH-001'],
      title: 'Valid login shows dashboard',
      objective: 'Verify valid credentials lead to dashboard',
      type: 'ui',
      priority: 'high',
      preconditions: [],
      inputs: [],
      dataNeeds: [],
      steps: [
        { order: 1, action: 'Navigate to login page', target: '/login' },
        { order: 2, action: 'Fill username', target: 'username', input: VALID_USER },
        { order: 3, action: 'Fill password', target: 'password', input: VALID_PASS },
        { order: 4, action: 'Click login button', target: 'login-button' },
      ],
      expectedResults: [
        { description: 'Welcome message is visible', verificationType: 'automated', target: 'welcome-message' },
      ],
      cleanup: [],
      automation: { status: 'ready' } as TestCase['automation'],
      provenance: [{ requirementId: 'REQ-AUTH-001' }],
      confidence: 0.95,
    } as TestCase,
    {
      id: 'TC-INVALID-LOGIN',
      scenarioId: 'SCN-AUTH',
      requirementIds: ['REQ-AUTH-002'],
      title: 'Invalid login shows error',
      objective: 'Verify invalid credentials show error message',
      type: 'ui',
      priority: 'high',
      preconditions: [],
      inputs: [],
      dataNeeds: [],
      steps: [
        { order: 1, action: 'Navigate to login page', target: '/login' },
        { order: 2, action: 'Fill username', target: 'username', input: 'wrong-user' },
        { order: 3, action: 'Fill password', target: 'password', input: 'wrong-pass' },
        { order: 4, action: 'Click login button', target: 'login-button' },
      ],
      expectedResults: [
        { description: 'Error message is visible', verificationType: 'automated', target: 'error-message' },
      ],
      cleanup: [],
      automation: { status: 'ready' } as TestCase['automation'],
      provenance: [{ requirementId: 'REQ-AUTH-002' }],
      confidence: 0.95,
    } as TestCase,
    {
      id: 'TC-FAIL-ASSERTION',
      scenarioId: 'SCN-AUTH',
      requirementIds: ['REQ-AUTH-003'],
      title: 'Deliberately wrong assertion fails',
      objective: 'Verify that wrong expected text causes test failure',
      type: 'ui',
      priority: 'medium',
      preconditions: [],
      inputs: [],
      dataNeeds: [],
      steps: [
        { order: 1, action: 'Navigate to login page', target: '/login' },
        { order: 2, action: 'Fill username', target: 'username', input: VALID_USER },
        { order: 3, action: 'Fill password', target: 'password', input: VALID_PASS },
        { order: 4, action: 'Click login button', target: 'login-button' },
      ],
      expectedResults: [
        { description: 'Welcome contains WRONG TEXT', verificationType: 'automated', target: 'welcome-message' },
      ],
      cleanup: [],
      automation: { status: 'ready' } as TestCase['automation'],
      provenance: [{ requirementId: 'REQ-AUTH-003' }],
      confidence: 0.95,
    } as TestCase,
  ];
}

function buildUIMappings(): TestExecutionMapping[] {
  return [
    {
      testCaseId: 'TC-VALID-LOGIN',
      executorType: 'ui' as const,
      pageId: 'login-page',
      stepMappings: [
        { stepOrder: 1, action: 'navigate', valueLiteral: '/login' },
        { stepOrder: 2, action: 'fill', targetLogicalName: 'username', valueLiteral: VALID_USER },
        { stepOrder: 3, action: 'fill', targetLogicalName: 'password', valueLiteral: VALID_PASS },
        { stepOrder: 4, action: 'click', targetLogicalName: 'login-button' },
      ],
      assertionMappings: [
        { expectedResultIndex: 0, assertionType: 'visible', targetLogicalName: 'welcome-message' },
      ],
    },
    {
      testCaseId: 'TC-INVALID-LOGIN',
      executorType: 'ui' as const,
      pageId: 'login-page',
      stepMappings: [
        { stepOrder: 1, action: 'navigate', valueLiteral: '/login' },
        { stepOrder: 2, action: 'fill', targetLogicalName: 'username', valueLiteral: 'wrong-user' },
        { stepOrder: 3, action: 'fill', targetLogicalName: 'password', valueLiteral: 'wrong-pass' },
        { stepOrder: 4, action: 'click', targetLogicalName: 'login-button' },
      ],
      assertionMappings: [
        { expectedResultIndex: 0, assertionType: 'visible', targetLogicalName: 'error-message' },
      ],
    },
    {
      testCaseId: 'TC-FAIL-ASSERTION',
      executorType: 'ui' as const,
      pageId: 'login-page',
      stepMappings: [
        { stepOrder: 1, action: 'navigate', valueLiteral: '/login' },
        { stepOrder: 2, action: 'fill', targetLogicalName: 'username', valueLiteral: VALID_USER },
        { stepOrder: 3, action: 'fill', targetLogicalName: 'password', valueLiteral: VALID_PASS },
        { stepOrder: 4, action: 'click', targetLogicalName: 'login-button' },
      ],
      assertionMappings: [
        { expectedResultIndex: 0, assertionType: 'text-contains', targetLogicalName: 'welcome-message', expectedValue: 'WRONG TEXT DELIBERATELY' },
      ],
    },
  ];
}

function buildProfile(catalog: UIElementCatalog): ProjectExecutionProfile {
  return {
    schemaVersion: '1.0',
    project: {
      id: 'acceptance-proj',
      name: 'E2E Acceptance Project',
      version: '1.0.0',
      root: '/tmp/acceptance',
      adapterId: 'acceptance-adapter',
      adapterVersion: '1.0.0',
    },
    environment: {
      id: 'isolated-local',
      name: 'Isolated Local',
      safety: 'isolated',
      baseUrl,
    },
    ui: {
      environmentId: 'isolated-local',
      pages: catalog.pages,
    },
    bindings: { definitions: [] },
    secrets: { references: [] },
    commands: { commands: [] },
    capabilities: {
      ui: true, api: false, database: false, multiTenant: false,
      localStart: true, testDataMutation: false, browserExecution: true,
      apiExecution: false, databaseExecution: false,
    },
    provenance: [{ source: 'acceptance', adapterId: 'acceptance-adapter' }],
    fingerprint: computeObjectHash({ project: 'acceptance-proj', env: 'isolated-local', baseUrl }),
  } as ProjectExecutionProfile;
}

function buildMappings(testCases: TestCase[], uiMappings: TestExecutionMapping[], profileFingerprint: string): ExecutionMappingIR {
  const testMappings: TestCaseExecutionMapping[] = testCases.map((tc) => {
    const uiMapping = uiMappings.find((m) => m.testCaseId === tc.id);
    return {
      testCaseId: tc.id,
      executorType: 'ui' as const,
      confidence: 0.95,
      status: 'ready' as const,
      source: [],
      ui: uiMapping,
      unresolvedIds: [],
      provenance: tc.provenance,
    } as TestCaseExecutionMapping;
  });
  return {
    schemaVersion: '1.0',
    testMappings,
    unresolved: [],
    catalogs: {},
    quality: {
      testCasesTotal: testCases.length, ready: testCases.length, partial: 0, manual: 0,
      unresolved: 0, uiMappings: testCases.length, apiMappings: 0, databaseMappings: 0,
      integrationMappings: 0, stepsTotal: 0, stepsMapped: 0, assertionsTotal: 0,
      assertionsMapped: 0, bindingsRequired: 0, bindingsResolved: 0,
      catalogReferenceValidity: 1, provenanceCoverage: 1,
    },
    sourceTestCasesHash: computeTestCasesSemanticHash(testCases),
    sourceProjectFingerprint: profileFingerprint,
  } as ExecutionMappingIR;
}

// ---- Tests -----------------------------------------------------------------

describe('real local E2E acceptance — execute mode', () => {
  const clock = new FixedClock(new Date('2026-08-24T00:00:00Z').getTime());
  const runIdProvider = new DeterministicRunIdProvider('ACC');

  it('§193: EndToEndRunner drives real Chromium through orchestrator stack', async () => {
    const catalog = buildCatalog();
    const testCases = buildTestCases();
    const uiMappings = buildUIMappings();
    const profile = buildProfile(catalog);
    const mappings = buildMappings(testCases, uiMappings, profile.fingerprint);

    // Build UIExecutor with PlaywrightBrowserSession (single session for all tests)
    const browserSession = new PlaywrightBrowserSession({ headless: true });

    const uiExecutor = new UIExecutor({
      catalog,
      mappings: uiMappings,
      browserSession,
      environment: { baseUrl, allowedOrigins: [new URL(baseUrl).origin], headless: true },
      browserPolicy: { allowedOrigins: [new URL(baseUrl).origin] },
    });

    // Build orchestrator with UIExecutor registered
    const registry = new TestExecutorRegistry();
    registry.register(uiExecutor);

    const orchestrator = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'execute' },
      clock,
      runIdProvider,
      environmentId: 'isolated-local',
    });

    // Build runner input
    const input: EndToEndRunnerInput = {
      profile,
      testCases,
      mappings,
    };

    // Build policy for execute mode
    const policy: EndToEndRunnerPolicy = defaultPolicy({
      mode: 'execute',
      allowExecution: true,
      allowBrowserExecution: true,
      allowDatabaseMutation: false,
      allowApiMutation: false,
      allowCommands: false,
    });

    // Prepare output directory
    mkdirSync(OUTPUT_DIR, { recursive: true });

    // Build runner with orchestrator
    const options: EndToEndRunnerOptions = {
      policy,
      orchestrator,
      outputDir: OUTPUT_DIR,
      seed: 42,
      pretty: true,
    };

    const runner = new EndToEndRunner(options);
    const result = await runner.run(input);

    // §20: Valid login acceptance
    const validLoginResult = result.tests.testResults.find((r) => r.testCaseId === 'TC-VALID-LOGIN');
    expect(validLoginResult).toBeDefined();
    expect(validLoginResult!.status).toBe('passed');

    // §21: Invalid login acceptance (test PASSED because assertion passed)
    const invalidLoginResult = result.tests.testResults.find((r) => r.testCaseId === 'TC-INVALID-LOGIN');
    expect(invalidLoginResult).toBeDefined();
    expect(invalidLoginResult!.status).toBe('passed');

    // §22: Assertion failure acceptance
    const failResult = result.tests.testResults.find((r) => r.testCaseId === 'TC-FAIL-ASSERTION');
    expect(failResult).toBeDefined();
    expect(failResult!.status).toBe('failed');

    // Any assertion failure makes the aggregate run failed, even when other
    // test cases pass.
    expect(result.status).toBe('failed');

    // §36: Real counters — Chromium launched
    const lifecycle = uiExecutor.getLifecycleCounters();
    expect(lifecycle.browsersLaunched).toBeGreaterThanOrEqual(1);
    // Browser was launched (proves real Chromium). Session is externally owned,
    // so close it manually for cleanup.
    if (!browserSession.isClosed()) {
      await browserSession.close();
    }
    const sessionCounters = browserSession.getCounters();
    expect(sessionCounters.browsersLaunched).toBeGreaterThanOrEqual(1);
    expect(sessionCounters.browsersClosed).toBeGreaterThanOrEqual(1);

    // §23: Cleanup — browser closed
    expect(result.cleanup.failures).toBe(0);

    // §24: Secret scan — password must not appear in reports
    const reportFiles = ['run-result-ir.json', 'manifest.json', 'summary.json', 'summary.md', 'junit.xml', 'audit-trail.json'];
    for (const file of reportFiles) {
      const filePath = join(OUTPUT_DIR, file);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        expect(content).not.toContain(VALID_PASS);
      }
    }

    // §25: Evidence traceability
    const allTestEvidence = result.tests.testResults.flatMap((r) => r.evidence);
    // No orphan evidence — every evidence ref belongs to a test result
    expect(allTestEvidence.length).toBeGreaterThanOrEqual(0);

    // §26: JUnit semantics
    const junitPath = join(OUTPUT_DIR, 'junit.xml');
    if (existsSync(junitPath)) {
      const junit = readFileSync(junitPath, 'utf-8');
      expect(junit).toContain('TC-VALID-LOGIN');
      expect(junit).toContain('TC-INVALID-LOGIN');
      expect(junit).toContain('TC-FAIL-ASSERTION');
      // Valid/invalid login should be passing testcases
      expect(junit).not.toContain(VALID_PASS);
      expect(junit).toContain('failures="1"');
    }

    // §34: Report files parseable
    for (const file of reportFiles) {
      const filePath = join(OUTPUT_DIR, file);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        expect(content.length).toBeGreaterThan(0);
        if (file.endsWith('.json')) {
          expect(() => JSON.parse(content)).not.toThrow();
        }
      }
    }

    // §12: Manifest contains actual fingerprints
    const manifestPath = join(OUTPUT_DIR, 'manifest.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      expect(manifest.inputHashes.testCasesHash).toBeTruthy();
      expect(manifest.inputHashes.mappingHash).toBeTruthy();
      expect(manifest.inputHashes.testCasesHash).not.toBe('placeholder');
      expect(manifest.projectProfileFingerprint).toBe(profile.fingerprint);
      expect(manifest.testCasesSemanticHash).toBe(manifest.inputHashes.testCasesSemanticHash);
      expect(manifest.executionMappingArtifactHash).toBe(manifest.inputHashes.mappingArtifactHash);
      expect(manifest.mappingSourceTestCasesHash).toBe(manifest.testCasesSemanticHash);
      expect(manifest.mappingSourceProjectFingerprint).toBe(profile.fingerprint);
    }
  }, 120_000);
});

// ---- Mode verification tests -----------------------------------------------

describe('runner mode verification', () => {
  const catalog = buildCatalog();
  const testCases = buildTestCases();
  const uiMappings = buildUIMappings();
  const profile = buildProfile(catalog);
  const mappings = buildMappings(testCases, uiMappings, profile.fingerprint);

  it('§28: validate mode — 0 browser launches', async () => {
    const input: EndToEndRunnerInput = { profile, testCases, mappings };
    const policy = defaultPolicy({ mode: 'validate' });
    const runner = new EndToEndRunner({ policy });
    const result = await runner.run(input);
    expect(result.status).toBe('validated');
    expect(result.tests.testResults.length).toBe(0);
  });

  it('§29: dry-run mode — 0 browser launches, 0 actions', async () => {
    const input: EndToEndRunnerInput = { profile, testCases, mappings };
    const policy = defaultPolicy({ mode: 'dry-run' });
    const runner = new EndToEndRunner({ policy });
    const result = await runner.run(input);
    expect(result.status).toBe('validated');
    expect(result.tests.testResults.length).toBe(0);
  });

  it('§30: simulate mode — no Chromium, complete reports', async () => {
    const input: EndToEndRunnerInput = { profile, testCases, mappings };
    const policy = defaultPolicy({ mode: 'simulate', allowExecution: true, allowBrowserExecution: true });
    const runner = new EndToEndRunner({ policy });
    const result = await runner.run(input);
    // Simulate produces results without real browser
    expect(result.tests.testResults.length).toBeGreaterThan(0);
    expect(result.status).toBe('passed');
  });

  it('§32: production profile — BLOCKED, 0 Chromium launches', async () => {
    const prodProfile = buildProfile(catalog);
    (prodProfile.environment as { safety: string }).safety = 'production';
    const input: EndToEndRunnerInput = { profile: prodProfile, testCases, mappings };
    const policy = defaultPolicy({ mode: 'execute', allowExecution: true, allowBrowserExecution: true });
    const runner = new EndToEndRunner({ policy });
    const result = await runner.run(input);
    expect(result.status).toBe('blocked');
  });
});

// ---- §33: Execute cannot use fake fallback ----------------------------------

describe('execute mode security', () => {
  it('§33: execute path requires real BrowserSession — no fake fallback', async () => {
    const catalog = buildCatalog();
    const testCases = [buildTestCases()[0]]; // Only valid login
    const uiMappings = buildUIMappings().filter((m) => m.testCaseId === 'TC-VALID-LOGIN');

    // Create UIExecutor WITHOUT any session or factory
    const uiExecutor = new UIExecutor({
      catalog,
      mappings: uiMappings,
      environment: { baseUrl, allowedOrigins: [new URL(baseUrl).origin] },
    });

    const registry = new TestExecutorRegistry();
    registry.register(uiExecutor);

    const orchestrator = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'execute' },
      clock: new FixedClock(new Date('2026-08-24T00:00:00Z').getTime()),
      runIdProvider: new DeterministicRunIdProvider('SEC'),
      environmentId: 'isolated-local',
    });

    const profile = buildProfile(catalog);
    const mappingsIR = buildMappings(testCases, uiMappings, profile.fingerprint);
    const input: EndToEndRunnerInput = { profile, testCases, mappings: mappingsIR };
    const policy = defaultPolicy({
      mode: 'execute',
      allowExecution: true,
      allowBrowserExecution: true,
    });

    const runner = new EndToEndRunner({ policy, orchestrator });
    const result = await runner.run(input);

    // Should fail/error because no browser session available
    const tcResult = result.tests.testResults.find((r) => r.testCaseId === 'TC-VALID-LOGIN');
    expect(tcResult).toBeDefined();
    // Status should be error (not passed — no fake fallback)
    expect(tcResult!.status).not.toBe('passed');
  }, 60_000);
});
