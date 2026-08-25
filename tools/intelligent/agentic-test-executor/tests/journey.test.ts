import { afterAll, describe, expect, it } from 'vitest';
import type { AIGenerationRequest, AIGenerationResponse, AIProvider } from 'ai-provider';
import { InMemoryBindingStore } from 'execution-engine';
import { InMemoryEvidenceCollector } from 'test-execution-orchestrator';
import { PlaywrightBrowserSession } from 'ui-executor';
import { JourneyAgent } from '../src/journey/journey-agent.js';
import { validateAction } from '../src/action/action-validator.js';
import { defaultAgentPolicy } from '../src/models.js';
import { startFixtureServer, type FixtureServer } from './fixtures/fixture-server.js';

describe('Phase 2C JourneyAgent', () => {
  let fixture: FixtureServer;

  afterAll(async () => {
    await fixture?.close();
  });

  it('completes a four-state journey through an unexpected intermediate page', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const agent = new JourneyAgent({
      browserSession: session,
      aiProvider: new JourneyFakeAI(),
      baseUrl: `${fixture.origin}/journey-detour`,
      allowedOrigins: [fixture.origin],
    });
    const result = await run(agent, testCase('Item status: Completed'));

    expect(result.status).toBe('passed');
    expect(result.journey.observationHistory.length).toBeGreaterThanOrEqual(4);
    expect(result.metrics.uniqueSemanticStates).toBeGreaterThanOrEqual(3);
    expect(result.metrics.pageTransitions).toBeGreaterThanOrEqual(2);
    expect(result.journey.actionHistory.length).toBe(3);
    await agent.cleanup();
    const counters = session.getCounters();
    expect(counters.browsersLaunched).toBe(counters.browsersClosed);
    expect(counters.pagesCreated).toBe(counters.pagesClosed);
  }, 30_000);

  it('blocks an external navigation proposal without visiting it', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const agent = new JourneyAgent({
      browserSession: session,
      aiProvider: new ExternalNavigationAI(),
      baseUrl: `${fixture.origin}/journey-home`,
      allowedOrigins: [fixture.origin],
      policy: { maxJourneyReplans: 1, maxJourneyDecisions: 3 },
    });
    const result = await run(agent, testCase('Item status: Completed'));

    expect(result.status).toBe('blocked');
    expect(result.journey.actionHistory).toHaveLength(0);
    expect(result.journey.currentState.url).toContain(fixture.origin);
    await agent.cleanup();
  }, 30_000);

  it('treats a confirmation dialog as an intermediate semantic state', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const agent = new JourneyAgent({
      browserSession: session,
      aiProvider: new JourneyFakeAI(),
      baseUrl: `${fixture.origin}/journey-modal`,
      allowedOrigins: [fixture.origin],
    });
    const result = await run(agent, testCase('Item status: Completed'));

    expect(result.status).toBe('passed');
    expect(result.metrics.dialogTransitions).toBeGreaterThanOrEqual(2);
    expect(result.metrics.uniqueSemanticStates).toBeGreaterThanOrEqual(2);
    await agent.cleanup();
  }, 30_000);

  it('waits through a bounded loading state before grounding the next action', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const agent = new JourneyAgent({
      browserSession: session,
      aiProvider: new LoadingAI(),
      baseUrl: `${fixture.origin}/journey-loading`,
      allowedOrigins: [fixture.origin],
      policy: { maxJourneyDecisions: 8 },
    });
    const result = await run(agent, testCase('Item status: Completed'));

    expect(result.status).toBe('passed');
    expect(result.metrics.recoveries).toBeGreaterThanOrEqual(1);
    await agent.cleanup();
  }, 30_000);

  it('survives changed semantic labels without selector knowledge', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const agent = new JourneyAgent({
      browserSession: session,
      aiProvider: new JourneyFakeAI(),
      baseUrl: `${fixture.origin}/journey-home-changed`,
      allowedOrigins: [fixture.origin],
    });
    const result = await run(agent, testCase('Item status: Completed'));

    expect(result.status).toBe('passed');
    expect(result.metrics.pageTransitions).toBeGreaterThanOrEqual(2);
    await agent.cleanup();
  }, 30_000);

  it('blocks when the required destination cannot be grounded', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const agent = new JourneyAgent({
      browserSession: session,
      aiProvider: new NoActionAI(),
      baseUrl: `${fixture.origin}/journey-home`,
      allowedOrigins: [fixture.origin],
    });
    const result = await run(agent, testCase('Item status: Completed'));

    expect(result.status).toBe('blocked');
    expect(result.journey.actionHistory).toHaveLength(0);
    await agent.cleanup();
  }, 30_000);

  it('classifies a completed journey with a false final outcome as FAIL', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const agent = new JourneyAgent({
      browserSession: session,
      aiProvider: new WrongOutcomeAI(),
      baseUrl: `${fixture.origin}/journey-home`,
      allowedOrigins: [fixture.origin],
    });
    const result = await run(agent, testCase('A state that never appears'));

    expect(result.status).toBe('failed');
    expect(result.assertions.at(-1)?.status).toBe('failed');
    await agent.cleanup();
  }, 30_000);

  it('detects a repeated A-B navigation loop and blocks', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const agent = new JourneyAgent({
      browserSession: session,
      aiProvider: new JourneyFakeAI(),
      baseUrl: `${fixture.origin}/journey-loop-a`,
      allowedOrigins: [fixture.origin],
      policy: { maxJourneyDecisions: 10 },
    });
    const result = await run(agent, testCase('A state that never appears'));

    expect(result.status).toBe('blocked');
    expect(result.metrics.loopDetections).toBe(1);
    await agent.cleanup();
  }, 30_000);

  it('rejects an element ID from a stale observation', () => {
    const validation = validateAction(
      { type: 'click', elementId: 'el-001' },
      { url: 'http://127.0.0.1/current', title: 'Current', headings: [], pageText: '', elements: [{ id: 'el-002', role: 'button', enabled: true }], truncated: false },
      defaultAgentPolicy(),
      { navigationActions: 0, totalActions: 0 },
    );
    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain('stale');
  });

  it('consumes a Phase 2B runtime binding on a later journey state', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const item = {
      id: 'DATA-ITEM-CODE', name: 'item-code', description: 'Existing item code', type: 'input' as const,
      lifecycle: 'existing' as const, strategy: 'reuse-existing' as const, constraints: [], dependencies: [],
      relatedTestCaseIds: ['TC-BINDING'], relatedRequirementIds: [], relatedEntityIds: [], setup: [], cleanup: [], provenance: [], confidence: 1,
    };
    const agent = new JourneyAgent({
      browserSession: session,
      aiProvider: new BindingAI(),
      baseUrl: `${fixture.origin}/journey-binding`,
      allowedOrigins: [fixture.origin],
      testDataItems: [item],
    });
    const result = await run(agent, testCase('Item status: Completed', {
      id: 'TC-BINDING', inputs: [{ name: 'item-code', value: 'ITEM-001', valueStrategy: 'valid', description: 'Existing item code' }],
    }));

    expect(result.status).toBe('passed');
    expect(result.journey.runtimeBindings).toContain('runtime.DATA-ITEM-CODE');
    await agent.cleanup();
  }, 30_000);

  it('blocks when the journey decision budget is exhausted', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const agent = new JourneyAgent({
      browserSession: session,
      aiProvider: new JourneyFakeAI(),
      baseUrl: `${fixture.origin}/journey-home`,
      allowedOrigins: [fixture.origin],
      policy: { maxJourneyDecisions: 1 },
    });
    const result = await run(agent, testCase('Item status: Completed'));

    expect(result.status).toBe('blocked');
    expect(result.error?.code).toBe('JOURNEY_DECISION_BUDGET_EXCEEDED');
    await agent.cleanup();
  }, 30_000);

  it('classifies a browser startup failure as ERROR', async () => {
    const session = {
      async start(): Promise<void> { throw new Error('browser unavailable'); },
      page() { throw new Error('no page'); },
      async close(): Promise<void> {},
    } as never;
    const agent = new JourneyAgent({
      browserSession: session,
      aiProvider: new JourneyFakeAI(),
      baseUrl: 'http://127.0.0.1:1',
    });
    const result = await run(agent, testCase('Item status: Completed'));

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('JOURNEY_BROWSER_ERROR');
    await agent.cleanup();
  });

  it('recovers from a semantically wrong screen through observed UI', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const agent = new JourneyAgent({
      browserSession: session,
      aiProvider: new WrongPathAI(),
      baseUrl: `${fixture.origin}/journey-wrong-start`,
      allowedOrigins: [fixture.origin],
    });
    const result = await run(agent, testCase('Item status: Completed'));

    expect(result.status).toBe('passed');
    expect(result.metrics.pageTransitions).toBeGreaterThanOrEqual(3);
    await agent.cleanup();
  }, 30_000);
  it('switches to one allowed popup and re-grounds on the new page', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const agent = new JourneyAgent({ browserSession: session, aiProvider: new JourneyFakeAI(), baseUrl: `${fixture.origin}/journey-popup`, allowedOrigins: [fixture.origin] });
    const result = await run(agent, testCase('Item status: Completed'));
    expect(result.status).toBe('passed');
    expect(result.metrics.popupTransitions).toBeGreaterThanOrEqual(1);
    expect(result.journey.pageContexts.some((entry) => entry.active && entry.url.includes('/journey-detail'))).toBe(true);
    await agent.cleanup();
  }, 30_000);

  it('rejects an external popup without executing actions in it', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const agent = new JourneyAgent({ browserSession: session, aiProvider: new JourneyFakeAI(), baseUrl: `${fixture.origin}/journey-popup-external`, allowedOrigins: [fixture.origin] });
    const result = await run(agent, testCase('Item status: Completed'));
    expect(result.status).toBe('blocked');
    expect(['JOURNEY_EXTERNAL_POPUP_DENIED', 'JOURNEY_AMBIGUOUS_POPUP']).toContain(result.error?.code);
    expect(result.metrics.popupTransitions).toBe(0);
    await agent.cleanup();
  }, 30_000);

  it('fails closed when one action opens multiple ambiguous popups', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const agent = new JourneyAgent({ browserSession: session, aiProvider: new JourneyFakeAI(), baseUrl: `${fixture.origin}/journey-popup-ambiguous`, allowedOrigins: [fixture.origin] });
    const result = await run(agent, testCase('Item status: Completed'));
    expect(result.status).toBe('blocked');
    expect(result.error?.code).toBe('JOURNEY_AMBIGUOUS_POPUP');
    expect(result.metrics.popupTransitions).toBe(0);
    await agent.cleanup();
  }, 30_000);

  it('uses bounded browser history recovery and blocks when no progress remains', async () => {
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const agent = new JourneyAgent({ browserSession: session, aiProvider: new ThenNoActionAI(), baseUrl: `${fixture.origin}/journey-home`, allowedOrigins: [fixture.origin], policy: { maxJourneyRecoveries: 1 } });
    const result = await run(agent, testCase('Item status: Completed'));
    expect(result.status).toBe('blocked');
    expect(result.metrics.recoveries).toBe(1);
    expect(result.journey.actionHistory.some((action) => action.actionType === 'goBack')).toBe(true);
    await agent.cleanup();
  }, 30_000);
});

function testCase(expected: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `TC-JOURNEY-${expected.slice(0, 8).replace(/\W/g, '')}`,
    scenarioId: 'SC-JOURNEY',
    requirementIds: ['REQ-JOURNEY'],
    title: 'Complete catalog item',
    objective: 'Complete an item across multiple application states.',
    type: 'functional' as const,
    priority: 'high' as const,
    preconditions: [],
    inputs: [],
    steps: [{ order: 1, action: 'Complete the item and verify the final state.' }],
    expectedResults: [{ description: expected, verificationType: 'ui' }],
    cleanup: [],
    automation: { status: 'ready' as const, suggestedExecutor: 'ui', reasons: [] },
    provenance: [],
    confidence: 1,
    ...overrides,
  } as Parameters<JourneyAgent['execute']>[0];
}

async function run(agent: JourneyAgent, tc: Parameters<JourneyAgent['execute']>[0]) {
  const evidence = new InMemoryEvidenceCollector();
  const context = {
    mode: 'live',
    policy: { maxRetries: 0, timeoutMs: 30_000, parallelism: 1, stopOnFailure: false },
    bindings: new InMemoryBindingStore(),
    secrets: { async resolve(): Promise<never> { throw new Error('no secrets in journey fixture'); } },
    evidence,
    audit: { record: async () => {} },
    clock: { now: () => new Date().toISOString() },
    runId: 'RUN-JOURNEY-001',
    testCaseId: tc.id,
    environmentId: 'ENV-JOURNEY',
  } as unknown as Parameters<JourneyAgent['execute']>[1];
  return agent.execute(tc, context);
}

class JourneyFakeAI implements AIProvider {
  readonly name = 'journey-fake';
  readonly capabilities = { jsonMode: true, toolCalling: false, vision: false };

  async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const system = request.messages[0]?.content ?? '';
    const data = system.includes('verification')
      ? { assertionType: 'text-visible', expectedValue: 'Item status: Completed', confidence: 'high', reasoning: 'The final status is observable.' }
      : { action: { type: 'click', elementId: 'el-001' }, confidence: 'high', reasoning: 'The current page exposes the next semantic link or action.' };
    return { data: data as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}

class ExternalNavigationAI extends JourneyFakeAI {
  override async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const system = request.messages[0]?.content ?? '';
    const data = system.includes('verification')
      ? { assertionType: 'text-visible', expectedValue: 'Item status: Completed', confidence: 'high', reasoning: 'Not complete.' }
      : { action: { type: 'navigate', url: 'https://evil.example.invalid/' }, confidence: 'high', reasoning: 'Navigate to the proposed destination.' };
    return { data: data as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}

class LoadingAI extends JourneyFakeAI {
  override async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const system = request.messages[0]?.content ?? '';
    const serialized = request.messages.map((message) => message.content).join('\n');
    const data = system.includes('verification')
      ? { assertionType: 'text-visible', expectedValue: 'Item status: Completed', confidence: 'high', reasoning: 'The final status is observable.' }
      : serialized.includes('Title: Loading')
        ? { confidence: 'medium', reasoning: 'The application is still loading.', unresolvedReason: 'LOADING' }
        : { action: { type: 'click', elementId: 'el-001' }, confidence: 'high', reasoning: 'Continue the journey.' };
    return { data: data as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}

class NoActionAI extends JourneyFakeAI {
  override async generate<T>(_request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    return { data: { confidence: 'low', reasoning: 'No grounded target exists.', unresolvedReason: 'MISSING_DESTINATION' } as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}

class ThenNoActionAI extends JourneyFakeAI {
  private calls = 0;
  override async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const system = request.messages[0]?.content ?? '';
    if (system.includes('verification')) return { data: { confidence: 'low', reasoning: 'Outcome is not yet proven.', unresolvedReason: 'NOT_READY' } as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    this.calls++;
    const data = this.calls === 1
      ? { action: { type: 'click', elementId: 'el-001' }, confidence: 'high', reasoning: 'Open the catalog.' }
      : { confidence: 'low', reasoning: 'No further target exists.', unresolvedReason: 'DEAD_END' };
    return { data: data as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}

class BindingAI extends JourneyFakeAI {
  private calls = 0;

  override async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const system = request.messages[0]?.content ?? '';
    if (system.includes('verification')) {
      return { data: { assertionType: 'text-visible', expectedValue: 'Item status: Completed', confidence: 'high', reasoning: 'The final status is observable.' } as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    }
    this.calls++;
    const data = this.calls === 1
      ? { action: { type: 'fill', elementId: 'el-001', valueSource: 'testdata://DATA-ITEM-CODE' }, confidence: 'high', reasoning: 'Use the prepared item code.' }
      : this.calls === 2
        ? { action: { type: 'click', elementId: 'el-002' }, confidence: 'high', reasoning: 'Submit the item search.' }
        : { action: { type: 'click', elementId: 'el-001' }, confidence: 'high', reasoning: 'Complete the item.' };
    return { data: data as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}

class WrongPathAI extends JourneyFakeAI {
  private calls = 0;

  override async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const system = request.messages[0]?.content ?? '';
    if (system.includes('verification')) {
      return { data: { assertionType: 'text-visible', expectedValue: 'Item status: Completed', confidence: 'high', reasoning: 'The final status is observable.' } as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    }
    this.calls++;
    const data = { action: { type: 'click', elementId: 'el-001' }, confidence: 'high', reasoning: 'Use the currently observed semantic recovery link.' };
    return { data: data as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}

class WrongOutcomeAI extends JourneyFakeAI {
  private groundCalls = 0;

  override async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const system = request.messages[0]?.content ?? '';
    const data = system.includes('verification')
      ? { assertionType: 'text-visible', expectedValue: 'A state that never appears', confidence: 'high', reasoning: 'The required outcome is not visible.' }
      : ++this.groundCalls >= 3
        ? { confidence: 'high', reasoning: 'No further action can prove the requested outcome.', unresolvedReason: 'GOAL_NOT_REACHED' }
        : { action: { type: 'click', elementId: 'el-001' }, confidence: 'high', reasoning: 'Continue the journey.' };
    return { data: data as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}
