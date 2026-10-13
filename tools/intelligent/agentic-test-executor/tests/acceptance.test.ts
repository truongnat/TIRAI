// ---------------------------------------------------------------------------
// Acceptance tests — real Playwright + fixture server + deterministic grounding
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type BrowserSession, PlaywrightBrowserSession } from 'ui-executor';
import { AgenticTestExecutor } from '../src/agent.js';
import { defaultCapabilities, defaultAgentPolicy, type DataResolutionResult } from '../src/models.js';
import { startFixtureServer, type FixtureServer } from './fixtures/fixture-server.js';
import { makeTestCase, makeContext } from './fixtures/helpers.js';
import type { TestCase } from 'test-execution-orchestrator';
import type { TestDataItem } from 'test-data-planner';

let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
});

afterAll(async () => {
  await server.close();
});

async function runScenario(
  tc: TestCase,
  testDataItems: TestDataItem[] = [],
  basePath = '/login',
): Promise<{ status: string; error?: string; resolutions: ReadonlyArray<DataResolutionResult> }> {
  const session = new PlaywrightBrowserSession();

  const executor = new AgenticTestExecutor({
    browserSession: session,
    baseUrl: `${server.origin}${basePath}`,
    capabilities: { ...defaultCapabilities(), browser: 'AVAILABLE' },
    policy: defaultAgentPolicy(),
    allowedOrigins: [server.origin],
    testDataItems,
  });

  const ctx = makeContext();

  try {
    const result = await executor.execute(tc, ctx);
    return {
      status: result.status,
      error: result.error?.message,
      resolutions: executor.getLastDataResolutions(),
    };
  } finally {
    await executor.cleanup(tc, ctx);
  }
}

describe('Scenario A2: Phase 2B runtime data bindings', () => {
  it('resolves supplied account, generates invalid password, and executes using bindings', async () => {
    const tc = makeTestCase({
      id: 'TC-A2',
      title: 'Negative login with Phase 2B data',
      inputs: [
        { name: 'valid-username', valueStrategy: 'valid', value: 'demo' },
        { name: 'invalid-password', valueStrategy: 'generated' },
      ],
      steps: [
        { order: 1, action: 'Enter "Username"', input: 'testdata://DATA-ACCOUNT' },
        { order: 2, action: 'Enter "Password"', input: 'testdata://DATA-INVALID-PASSWORD' },
        { order: 3, action: 'Click "Login"' },
      ],
      expectedResults: [
        { description: 'Error message "Invalid credentials" is displayed', verificationType: 'ui' },
      ],
    });
    const result = await runScenario(tc, [
      {
        id: 'DATA-ACCOUNT',
        name: 'valid-username',
        description: 'Valid existing login account username',
        type: 'account',
        lifecycle: 'existing',
        strategy: 'reuse-existing',
        constraints: [],
        dependencies: [],
        relatedTestCaseIds: ['TC-A2'],
        relatedRequirementIds: [],
        relatedEntityIds: [],
        setup: [],
        cleanup: [],
        provenance: [],
        confidence: 1,
      },
      {
        id: 'DATA-INVALID-PASSWORD',
        name: 'invalid-password',
        description: 'Invalid password for negative login',
        type: 'input',
        lifecycle: 'generated',
        strategy: 'generate',
        constraints: [],
        dependencies: [],
        relatedTestCaseIds: ['TC-A2'],
        relatedRequirementIds: [],
        relatedEntityIds: [],
        setup: [{ type: 'generate', description: 'Generate invalid password' }],
        cleanup: [],
        provenance: [],
        confidence: 1,
      },
    ]);

    expect(result.status).toBe('passed');
    expect(result.resolutions.map((resolution) => resolution.status)).toEqual(['RESOLVED', 'GENERATED']);
  });
});

// ---- Scenario A: Negative login (invalid password) -------------------------

describe('Scenario A: Negative login', () => {
  it('PASS when error message displayed for invalid credentials', async () => {
    const tc = makeTestCase({
      id: 'TC-A',
      title: 'Negative login',
      steps: [
        { order: 1, action: 'Enter "Username"', input: 'demo' },
        { order: 2, action: 'Enter "Password"', input: 'wrong-pass' },
        { order: 3, action: 'Click "Login"' },
      ],
      expectedResults: [
        { description: 'Error message "Invalid credentials" is displayed', verificationType: 'ui' },
      ],
    });

    const result = await runScenario(tc);
    expect(result.status).toBe('passed');
  });
});

// ---- Scenario B: Positive login -------------------------------------------

describe('Scenario B: Positive login', () => {
  it('PASS when dashboard shown for valid credentials', async () => {
    const tc = makeTestCase({
      id: 'TC-B',
      title: 'Positive login',
      steps: [
        { order: 1, action: 'Enter "Username"', input: 'demo' },
        { order: 2, action: 'Enter "Password"', input: 'test-password' },
        { order: 3, action: 'Click "Login"' },
      ],
      expectedResults: [
        { description: 'Message "Welcome, demo!" is displayed', verificationType: 'ui' },
      ],
    });

    const result = await runScenario(tc);
    expect(result.status).toBe('passed');
  });
});

// ---- Scenario C: UI change resilience -------------------------------------

describe('Scenario C: UI change resilience', () => {
  it('PASS when the test plan uses the labels the changed UI exposes', async () => {
    const session = new PlaywrightBrowserSession();

    const executor = new AgenticTestExecutor({
      browserSession: session,
      baseUrl: `${server.origin}/ui-changed-login`,
      capabilities: { ...defaultCapabilities(), browser: 'AVAILABLE' },
      policy: defaultAgentPolicy(),
      allowedOrigins: [server.origin],
    });

    const tc = makeTestCase({
      id: 'TC-C',
      title: 'UI changed login',
      steps: [
        { order: 1, action: 'Enter "Email Address"', input: 'demo' },
        { order: 2, action: 'Enter "Secret Phrase"', input: 'test-password' },
        { order: 3, action: 'Click "Sign In"' },
      ],
      expectedResults: [
        { description: 'Message "Welcome, demo!" is displayed', verificationType: 'ui' },
      ],
    });

    try {
      const result = await executor.execute(tc, makeContext());
      expect(result.status).toBe('passed');
    } finally {
      await executor.cleanup(tc, makeContext());
    }
  });
});

// ---- Scenario D: Ambiguous buttons ----------------------------------------

describe('Scenario D: Ambiguous buttons', () => {
  it('PASS when the exact "Login" button is uniquely matched', async () => {
    const tc = makeTestCase({
      id: 'TC-D',
      title: 'Ambiguous login buttons',
      steps: [
        { order: 1, action: 'Enter "Username"', input: 'demo' },
        { order: 2, action: 'Enter "Password"', input: 'test-password' },
        { order: 3, action: 'Click "Login"' },
      ],
      expectedResults: [
        { description: 'Message "Welcome, demo!" is displayed', verificationType: 'ui' },
      ],
    });

    const result = await runScenario(tc, [], '/ambiguous-login');
    expect(result.status).toBe('passed');
  });

  it('BLOCKED when the step target matches multiple elements (fail-closed)', async () => {
    const tc = makeTestCase({
      id: 'TC-D2',
      title: 'Ambiguous login buttons',
      steps: [
        { order: 1, action: 'Enter "Username"', input: 'demo' },
        { order: 2, action: 'Enter "Password"', input: 'test-password' },
        { order: 3, action: 'Click "login with"' },
      ],
      expectedResults: [
        { description: 'Message "Welcome, demo!" is displayed', verificationType: 'ui' },
      ],
    });

    const result = await runScenario(tc, [], '/ambiguous-login');
    expect(result.status).toBe('blocked');
  });
});

// ---- Scenario E: Missing element ------------------------------------------

describe('Scenario E: Missing element', () => {
  it('BLOCKED when required element is absent', async () => {
    const session = new PlaywrightBrowserSession();

    const executor = new AgenticTestExecutor({
      browserSession: session,
      baseUrl: `${server.origin}/no-password`,
      capabilities: { ...defaultCapabilities(), browser: 'AVAILABLE' },
      policy: defaultAgentPolicy(),
      allowedOrigins: [server.origin],
    });

    const tc = makeTestCase({
      id: 'TC-E',
      title: 'Missing password field',
      steps: [
        { order: 1, action: 'Enter "Username"', input: 'demo' },
        { order: 2, action: 'Enter "Password"', input: 'test-password' },
        { order: 3, action: 'Click "Login"' },
      ],
      expectedResults: [
        { description: 'Dashboard shown', verificationType: 'ui' },
      ],
    });

    try {
      const result = await executor.execute(tc, makeContext());
      expect(result.status).toBe('blocked');
    } finally {
      await executor.cleanup(tc, makeContext());
    }
  });
});

// ---- Scenario F: Wrong product behavior -----------------------------------

describe('Scenario F: Wrong product behavior', () => {
  it('FAIL when app accepts any credentials (no validation)', async () => {
    const session = new PlaywrightBrowserSession();

    const executor = new AgenticTestExecutor({
      browserSession: session,
      baseUrl: `${server.origin}/wrong-behavior`,
      capabilities: { ...defaultCapabilities(), browser: 'AVAILABLE' },
      policy: defaultAgentPolicy(),
      allowedOrigins: [server.origin],
    });

    const tc = makeTestCase({
      id: 'TC-F',
      title: 'Wrong behavior - accepts invalid',
      steps: [
        { order: 1, action: 'Enter "Username"', input: 'demo' },
        { order: 2, action: 'Enter "Password"', input: 'wrong-password' },
        { order: 3, action: 'Click "Login"' },
      ],
      expectedResults: [
        { description: 'Error message "Invalid credentials" is displayed', verificationType: 'ui' },
      ],
    });

    try {
      const result = await executor.execute(tc, makeContext());
      expect(result.status).toBe('failed');
    } finally {
      await executor.cleanup(tc, makeContext());
    }
  });
});

// ---- Scenario G: Browser crash --------------------------------------------

describe('Scenario G: Browser crash', () => {
  it('ERROR when browser session fails', async () => {
    const crashSession = {
      start: async () => { throw new Error('Chromium crashed'); },
      page: () => { throw new Error('No page'); },
      screenshot: async () => Buffer.from(''),
      close: async () => {},
      isClosed: () => true,
    };

    const executor = new AgenticTestExecutor({
      browserSession: crashSession as unknown as BrowserSession,
      baseUrl: `${server.origin}/login`,
      capabilities: { ...defaultCapabilities(), browser: 'AVAILABLE' },
    });

    const result = await executor.execute(makeTestCase(), makeContext());
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('AGENT_BROWSER_ERROR');
  });
});
