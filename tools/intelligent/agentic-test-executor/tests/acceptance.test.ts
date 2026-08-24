// ---------------------------------------------------------------------------
// Acceptance tests — real Playwright + fixture server + deterministic AI
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type BrowserSession, PlaywrightBrowserSession } from 'ui-executor';
import type { AIProvider, AIGenerationRequest, AIGenerationResponse } from 'ai-provider';
import { AgenticTestExecutor } from '../src/agent.js';
import { defaultCapabilities, defaultAgentPolicy } from '../src/models.js';
import { startFixtureServer, type FixtureServer } from './fixtures/fixture-server.js';
import { makeTestCase, makeContext } from './fixtures/helpers.js';
import type { TestCase } from 'test-execution-orchestrator';

let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
});

afterAll(async () => {
  await server.close();
});

function createSmartAI(scenario: string): AIProvider {
  return {
    name: 'smart-fake',
    capabilities: { structuredOutput: true, strictStructuredOutput: true, streaming: false },
    async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
      const userMsg = request.messages.find((m) => m.role === 'user')?.content ?? '';
      const data = routeAI(scenario, userMsg) as T;
      return { provider: 'smart-fake', model: 'fake-model', data };
    },
  };
}

function findElementId(userMsg: string, roleHint: string, nameHint?: string): string | undefined {
  const lines = userMsg.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('el-')) continue;
    const parts = trimmed.split(/\s+/);
    const id = parts[0];
    const role = parts[1] ?? '';
    const hasName = nameHint ? trimmed.toLowerCase().includes(nameHint.toLowerCase()) : true;
    if (role.includes(roleHint) && hasName) return id;
  }
  return undefined;
}

function routeAI(scenario: string, userMessage: string): unknown {
  if (userMessage.includes('Expected result') || userMessage.includes('Verification type')) {
    return routeAssertion(scenario, userMessage);
  }
  return routeStep(scenario, userMessage);
}

function routeStep(scenario: string, msg: string): unknown {
  const stepLine = msg.split('\n').find((l) => l.startsWith('Test step:')) ?? '';
  const inputLine = msg.split('\n').find((l) => l.startsWith('Input:')) ?? '';
  const stepDesc = `${stepLine} ${inputLine}`.toLowerCase();

  if (stepDesc.includes('username') || stepDesc.includes('email')) {
    const id = findElementId(msg, 'textbox', 'username') ?? findElementId(msg, 'textbox', 'email') ?? 'el-001';
    return { action: { type: 'fill', elementId: id, value: 'demo' }, confidence: 'high', reasoning: 'fill username' };
  }

  if (stepDesc.includes('wrong password')) {
    const id = findElementId(msg, 'textbox', 'password') ?? findElementId(msg, 'textbox', 'secret') ?? 'el-002';
    return { action: { type: 'fill', elementId: id, value: 'wrong-password' }, confidence: 'high', reasoning: 'fill wrong password' };
  }

  if (stepDesc.includes('password') || stepDesc.includes('secret')) {
    const id = findElementId(msg, 'textbox', 'password') ?? findElementId(msg, 'textbox', 'secret') ?? 'el-002';
    const value = scenario === 'wrong-behavior' ? 'anything' : 'test-password';
    return { action: { type: 'fill', elementId: id, value }, confidence: 'high', reasoning: 'fill password' };
  }

  if (stepDesc.includes('login') || stepDesc.includes('submit') || stepDesc.includes('sign in')) {
    const id = findElementId(msg, 'button', 'login') ?? findElementId(msg, 'button', 'sign in') ?? findElementId(msg, 'button', 'submit') ?? 'el-003';
    return { action: { type: 'click', elementId: id }, confidence: 'high', reasoning: 'click login' };
  }

  if (stepDesc.includes('click')) {
    const id = findElementId(msg, 'button') ?? 'el-003';
    return { action: { type: 'click', elementId: id }, confidence: 'high', reasoning: 'click' };
  }

  if (stepDesc.includes('navigate') || stepDesc.includes('go to')) {
    return { action: { type: 'navigate', url: '/login' }, confidence: 'high', reasoning: 'navigate' };
  }

  if (scenario === 'missing-element' && stepDesc.includes('password')) {
    return { action: undefined, confidence: 'low', reasoning: 'No password field', unresolvedReason: 'AGENT_GROUNDING_FAILED' };
  }

  return { action: { type: 'observe' }, confidence: 'medium', reasoning: 'default observe' };
}

function routeAssertion(scenario: string, msg: string): unknown {
  const lower = msg.toLowerCase();

  if (lower.includes('welcome') || lower.includes('dashboard')) {
    if (scenario === 'wrong-behavior') {
      return { assertionType: 'text-visible', expectedValue: 'Welcome, demo!', confidence: 'high', reasoning: 'check dashboard' };
    }
    return { assertionType: 'text-visible', expectedValue: 'Welcome, demo!', confidence: 'high', reasoning: 'check dashboard' };
  }

  if (lower.includes('error') || lower.includes('invalid')) {
    return { assertionType: 'text-visible', expectedValue: 'Invalid credentials', confidence: 'high', reasoning: 'check error' };
  }

  if (lower.includes('url') || lower.includes('dashboard')) {
    return { assertionType: 'url-contains', expectedValue: '/dashboard', confidence: 'high', reasoning: 'check url' };
  }

  return { assertionType: 'text-visible', expectedValue: 'Login', confidence: 'medium', reasoning: 'default' };
}

async function runScenario(scenario: string, tc: TestCase): Promise<{ status: string; error?: string }> {
  const session = new PlaywrightBrowserSession();
  const ai = createSmartAI(scenario);

  const executor = new AgenticTestExecutor({
    browserSession: session,
    aiProvider: ai,
    baseUrl: `${server.origin}/login`,
    capabilities: { ...defaultCapabilities(), browser: 'AVAILABLE' },
    policy: defaultAgentPolicy(),
    allowedOrigins: [server.origin],
  });

  const ctx = makeContext();

  try {
    const result = await executor.execute(tc, ctx);
    return { status: result.status, error: result.error?.message };
  } finally {
    await executor.cleanup(tc, ctx);
  }
}

// ---- Scenario A: Negative login (invalid password) -------------------------

describe('Scenario A: Negative login', () => {
  it('PASS when error message displayed for invalid credentials', async () => {
    const tc = makeTestCase({
      id: 'TC-A',
      title: 'Negative login',
      steps: [
        { order: 1, action: 'Enter username', input: 'demo' },
        { order: 2, action: 'Enter wrong password', input: 'wrong-pass' },
        { order: 3, action: 'Click login button' },
      ],
      expectedResults: [
        { description: 'Error message "Invalid credentials" is displayed', verificationType: 'ui' },
      ],
    });

    const result = await runScenario('negative-login', tc);
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
        { order: 1, action: 'Enter username', input: 'demo' },
        { order: 2, action: 'Enter password', input: 'test-password' },
        { order: 3, action: 'Click login button' },
      ],
      expectedResults: [
        { description: 'Dashboard welcome message is shown', verificationType: 'ui' },
      ],
    });

    const result = await runScenario('positive-login', tc);
    expect(result.status).toBe('passed');
  });
});

// ---- Scenario C: UI change resilience -------------------------------------

describe('Scenario C: UI change resilience', () => {
  it('PASS when UI changes but semantics remain', async () => {
    const session = new PlaywrightBrowserSession();
    const ai = createSmartAI('ui-changed');

    const executor = new AgenticTestExecutor({
      browserSession: session,
      aiProvider: ai,
      baseUrl: `${server.origin}/ui-changed-login`,
      capabilities: { ...defaultCapabilities(), browser: 'AVAILABLE' },
      policy: defaultAgentPolicy(),
      allowedOrigins: [server.origin],
    });

    const tc = makeTestCase({
      id: 'TC-C',
      title: 'UI changed login',
      steps: [
        { order: 1, action: 'Enter username', input: 'demo' },
        { order: 2, action: 'Enter password', input: 'test-password' },
        { order: 3, action: 'Click sign in button' },
      ],
      expectedResults: [
        { description: 'Dashboard welcome message is shown', verificationType: 'ui' },
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
  it('PASS when correct login button selected among alternatives', async () => {
    const tc = makeTestCase({
      id: 'TC-D',
      title: 'Ambiguous login buttons',
      steps: [
        { order: 1, action: 'Enter username', input: 'demo' },
        { order: 2, action: 'Enter password', input: 'test-password' },
        { order: 3, action: 'Click the primary login button' },
      ],
      expectedResults: [
        { description: 'Dashboard welcome message is shown', verificationType: 'ui' },
      ],
    });

    const result = await runScenario('ambiguous', tc);
    expect(result.status).toBe('passed');
  });
});

// ---- Scenario E: Missing element ------------------------------------------

describe('Scenario E: Missing element', () => {
  it('BLOCKED when required element is absent', async () => {
    const session = new PlaywrightBrowserSession();
    const ai: AIProvider = {
      name: 'smart-fake',
      capabilities: { structuredOutput: true, strictStructuredOutput: true, streaming: false },
      async generate<T>(_request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
        const data = {
          action: undefined,
          confidence: 'low',
          reasoning: 'No password field found on page',
          unresolvedReason: 'AGENT_GROUNDING_FAILED',
        } as T;
        return { provider: 'smart-fake', model: 'fake-model', data };
      },
    };

    const executor = new AgenticTestExecutor({
      browserSession: session,
      aiProvider: ai,
      baseUrl: `${server.origin}/no-password`,
      capabilities: { ...defaultCapabilities(), browser: 'AVAILABLE' },
      policy: defaultAgentPolicy(),
      allowedOrigins: [server.origin],
    });

    const tc = makeTestCase({
      id: 'TC-E',
      title: 'Missing password field',
      steps: [
        { order: 1, action: 'Enter username', input: 'demo' },
        { order: 2, action: 'Enter password', input: 'test-password' },
        { order: 3, action: 'Click login' },
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
    const ai: AIProvider = {
      name: 'smart-fake',
      capabilities: { structuredOutput: true, strictStructuredOutput: true, streaming: false },
      async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
        const userMsg = request.messages.find((m) => m.role === 'user')?.content ?? '';
        let data: unknown;
        if (userMsg.includes('Expected result')) {
          data = { assertionType: 'text-visible', expectedValue: 'Invalid credentials', confidence: 'high', reasoning: 'expect error' };
        } else if (userMsg.toLowerCase().includes('password')) {
          data = { action: { type: 'fill', elementId: 'el-002', value: 'wrong-password' }, confidence: 'high', reasoning: 'fill wrong password' };
        } else if (userMsg.toLowerCase().includes('username')) {
          data = { action: { type: 'fill', elementId: 'el-001', value: 'demo' }, confidence: 'high', reasoning: 'fill username' };
        } else {
          data = { action: { type: 'click', elementId: 'el-003' }, confidence: 'high', reasoning: 'click login' };
        }
        return { provider: 'smart-fake', model: 'fake-model', data: data as T };
      },
    };

    const executor = new AgenticTestExecutor({
      browserSession: session,
      aiProvider: ai,
      baseUrl: `${server.origin}/wrong-behavior`,
      capabilities: { ...defaultCapabilities(), browser: 'AVAILABLE' },
      policy: defaultAgentPolicy(),
      allowedOrigins: [server.origin],
    });

    const tc = makeTestCase({
      id: 'TC-F',
      title: 'Wrong behavior - accepts invalid',
      steps: [
        { order: 1, action: 'Enter username', input: 'demo' },
        { order: 2, action: 'Enter wrong password', input: 'wrong-password' },
        { order: 3, action: 'Click login' },
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
      aiProvider: createSmartAI('crash'),
      baseUrl: `${server.origin}/login`,
      capabilities: { ...defaultCapabilities(), browser: 'AVAILABLE' },
    });

    const result = await executor.execute(makeTestCase(), makeContext());
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('AGENT_BROWSER_ERROR');
  });
});
