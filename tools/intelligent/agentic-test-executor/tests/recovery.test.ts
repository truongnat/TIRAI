import { describe, expect, it } from 'vitest';
import type { AIGenerationRequest, AIGenerationResponse, AIProvider } from 'ai-provider';
import { PlaywrightBrowserSession, type BrowserPage } from 'ui-executor';
import { JourneyAgent } from '../src/journey/journey-agent.js';
import { startFixtureServer, type FixtureServer } from './fixtures/fixture-server.js';

describe('Phase 2D bounded runtime recovery', () => {
  let fixture: FixtureServer | undefined;

  it('re-observes and re-grounds after a stale action failure', async () => {
    fixture = await startFixtureServer();
    const session = new FailOnceSession();
    const agent = new JourneyAgent({
      browserSession: session,
      aiProvider: new RecoveryAI(),
      baseUrl: `${fixture.origin}/journey-home`,
      allowedOrigins: [fixture.origin],
      policy: { maxRecoveryAttempts: 2 },
    });
    const result = await agent.execute(testCase(), testContext());
    expect(result.status).toBe('passed');
    expect(result.metrics.failuresDetected).toBe(1);
    expect(result.metrics.successfulRecoveries).toBe(1);
    expect(result.journey.recoveryHistory[0]).toMatchObject({ classification: 'STALE_STATE', operation: 'REGROUND', outcome: 'SUCCESS' });
    expect(result.metrics.observations).toBeGreaterThanOrEqual(4);
    await agent.cleanup();
    expect(session.getCounters().browsersLaunched).toBe(session.getCounters().browsersClosed);
    await fixture.close();
  }, 30_000);

  it('does not blindly retry an ambiguous mutating action', async () => {
    fixture = await startFixtureServer();
    const session = new AmbiguousFailureSession();
    const agent = new JourneyAgent({ browserSession: session, aiProvider: new RecoveryAI(), baseUrl: `${fixture.origin}/journey-home`, allowedOrigins: [fixture.origin] });
    const result = await agent.execute(testCase(), testContext());
    expect(result.status).toBe('blocked');
    expect(result.error?.code).toBe('JOURNEY_RECOVERY_BLOCKED');
    expect(result.journey.recoveryHistory[0]).toMatchObject({ classification: 'AMBIGUOUS_OUTCOME', operation: 'RECONCILE_OUTCOME' });
    expect(session.clickAttempts).toBe(1);
    await agent.cleanup();
    await fixture.close();
  }, 30_000);
});

function testCase() {
  return {
    id: 'TC-RECOVERY', scenarioId: 'SC-RECOVERY', requirementIds: ['REQ-RECOVERY'], title: 'Complete item', objective: 'Complete item after a transient runtime disruption.',
    type: 'functional' as const, priority: 'high' as const, preconditions: [], inputs: [],
    steps: [{ order: 1, action: 'Complete the item and verify the final state.' }],
    expectedResults: [{ description: 'Item status: Completed', verificationType: 'ui' as const }], cleanup: [],
    automation: { status: 'ready' as const, suggestedExecutor: 'ui' as const, reasons: [] }, provenance: [], confidence: 1,
  } as Parameters<JourneyAgent['execute']>[0];
}

function testContext() {
  return {
    mode: 'execute', policy: {}, bindings: { produce() {}, resolve() {}, isResolved() { return false; }, all() { return []; }, sensitiveNames() { return new Set<string>(); }, clearSensitive() {} },
    secrets: { async resolve(): Promise<never> { throw new Error('no secret capability'); } }, evidence: { add(input: never) { return input; }, list() { return []; } }, audit: { record() {} }, clock: { now: () => new Date(), nowIso: () => new Date().toISOString() }, runId: 'RUN-RECOVERY', testCaseId: 'TC-RECOVERY', environmentId: 'ENV-LOCAL',
  } as never;
}

class RecoveryAI implements AIProvider {
  readonly name = 'recovery-fake';
  readonly capabilities = { jsonMode: true, toolCalling: false, vision: false };
  async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const prompt = request.messages.map((message) => message.content).join('\n');
    const data = prompt.includes('verification')
      ? { assertionType: 'text-visible', expectedValue: 'Item status: Completed', confidence: 'high', reasoning: 'The final state is visible.' }
      : { action: { type: 'click', elementId: 'el-001' }, confidence: 'high', reasoning: 'Use the current semantic control.' };
    return { data: data as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}

class FailOnceSession extends PlaywrightBrowserSession {
  private fail = true;
  override async createIsolatedPage(): Promise<BrowserPage> {
    return this.wrap(await super.createIsolatedPage());
  }
  private wrap(page: BrowserPage): BrowserPage {
    return new Proxy(page, { get: (target, property, receiver) => {
      if (property === 'click') return async (...args: Parameters<BrowserPage['click']>) => { if (this.fail) { this.fail = false; throw new Error('element detached during rerender'); } return target.click(...args); };
      const method = Reflect.get(target, property, receiver);
      return typeof method === 'function' ? method.bind(target) : method;
    } }) as BrowserPage;
  }
}

class AmbiguousFailureSession extends FailOnceSession {
  clickAttempts = 0;
  override async createIsolatedPage(): Promise<BrowserPage> {
    const page = await super.createIsolatedPage();
    return new Proxy(page, { get: (target, property, receiver) => {
      if (property === 'click') return async () => { this.clickAttempts++; throw new Error('request timed out after submit may have reached server'); };
      const method = Reflect.get(target, property, receiver);
      return typeof method === 'function' ? method.bind(target) : method;
    } }) as BrowserPage;
  }
}
