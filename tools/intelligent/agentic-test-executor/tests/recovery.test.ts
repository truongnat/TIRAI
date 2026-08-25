import { describe, expect, it } from 'vitest';
import type { AIGenerationRequest, AIGenerationResponse, AIProvider } from 'ai-provider';
import { InMemoryBindingStore } from 'execution-engine';
import { InMemoryEvidenceCollector } from 'test-execution-orchestrator';
import { PlaywrightBrowserSession, type BrowserPage } from 'ui-executor';
import { JourneyAgent } from '../src/journey/journey-agent.js';
import type { ReconciliationRequest } from '../src/journey/recovery.js';
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

  it('recovers the trusted opener when the active popup closes', async () => {
    fixture = await startFixtureServer();
    const session = new PopupLossSession();
    const agent = new JourneyAgent({ browserSession: session, aiProvider: new PopupRecoveryAI(), baseUrl: `${fixture.origin}/journey-popup-recovery`, allowedOrigins: [fixture.origin] });
    const result = await agent.execute(testCase(), testContext());
    expect(result.status).toBe('passed');
    expect(result.metrics.pageRecoveries).toBe(1);
    expect(result.journey.recoveryHistory.some((event) => event.classification === 'PAGE_LOST')).toBe(true);
    await agent.cleanup();
    await fixture.close();
  }, 30_000);

  it('reauthenticates from a real login state and restores the semantic journey', async () => {
    fixture = await startFixtureServer();
    const session = new SessionExpirySession(`${fixture.origin}/journey-session-login`);
    const ai = new SessionRecoveryAI();
    const agent = new JourneyAgent({ browserSession: session, aiProvider: ai, baseUrl: `${fixture.origin}/journey-home`, allowedOrigins: [fixture.origin], testDataItems: credentialItems() });
    const result = await agent.execute(testCaseWithCredentials(), secretContext());
    expect(result.status).toBe('passed');
    expect(result.metrics.sessionRecoveries).toBe(1);
    expect(ai.rawSecretSeen).toBe(false);
    expect(result.journey.recoveryHistory.some((event) => event.classification === 'SESSION_LOST')).toBe(true);
    expect((result.journey.recoveryHistory as unknown as Array<{ secret?: string }>).some((event) => event.secret)).toBe(false);
    await agent.cleanup();
    await fixture.close();
  }, 30_000);

  it('blocks session recovery when no protected credential binding exists', async () => {
    fixture = await startFixtureServer();
    const session = new SessionExpirySession(`${fixture.origin}/journey-session-login`);
    const agent = new JourneyAgent({ browserSession: session, aiProvider: new RecoveryAI(), baseUrl: `${fixture.origin}/journey-home`, allowedOrigins: [fixture.origin] });
    const result = await agent.execute(testCase(), testContext());
    expect(result.status).toBe('blocked');
    expect(result.error?.code).toBe('JOURNEY_SESSION_RECOVERY_BLOCKED');
    expect(result.metrics.agentCalls).toBe(1);
    await agent.cleanup();
    await fixture.close();
  }, 30_000);

  it('adopts a resource proven to exist after an ambiguous mutation', async () => {
    fixture = await startFixtureServer();
    const session = new AmbiguousSuccessSession();
    let cleanupCalled = false;
    const reconciler = async (_request: ReconciliationRequest) => ({
      status: 'RECONCILED_SUCCESS' as const,
      ownership: 'TEST_OWNED' as const,
      journalRef: 'journal-reconciled-customer',
      binding: { id: 'CUSTOMER-1', name: 'runtime.customer', producerOperationId: 'PREP-1', value: 'CUSTOMER-1', sensitive: false, status: 'resolved' as const },
      cleanup: async () => { cleanupCalled = true; },
    });
    const agent = new JourneyAgent({ browserSession: session, aiProvider: new CustomerRecoveryAI(), baseUrl: `${fixture.origin}/journey-reconciled`, allowedOrigins: [fixture.origin], reconciliationAdapter: reconciler });
    const result = await agent.execute({ ...testCase(), expectedResults: [{ description: 'Customer status: Created', verificationType: 'ui' as const }] } as Parameters<JourneyAgent['execute']>[0], testContext());
    expect(result.status).toBe('passed');
    expect(result.metrics.outcomeReconciliations).toBe(1);
    expect(result.journey.recoveryHistory.at(-1)).toMatchObject({ classification: 'AMBIGUOUS_OUTCOME', operation: 'RECONCILE_OUTCOME', outcome: 'SUCCESS' });
    await agent.cleanup();
    expect(cleanupCalled).toBe(true);
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
    mode: 'execute', policy: {}, bindings: new InMemoryBindingStore(), secrets: { async resolve(): Promise<never> { throw new Error('no secret capability'); } }, evidence: new InMemoryEvidenceCollector(), audit: { record() {} }, clock: { now: () => new Date(), nowIso: () => new Date().toISOString() }, runId: 'RUN-RECOVERY', testCaseId: 'TC-RECOVERY', environmentId: 'ENV-LOCAL',
  } as never;
}

function testCaseWithCredentials() {
  return { ...testCase(), id: 'TC-SESSION-RECOVERY', inputs: [{ name: 'account', value: 'demo', valueStrategy: 'valid' }, { name: 'password', value: 'secret://password', valueStrategy: 'valid' }] } as Parameters<JourneyAgent['execute']>[0];
}

function credentialItems() {
  const base = { constraints: [], dependencies: [], relatedTestCaseIds: ['TC-SESSION-RECOVERY'], relatedRequirementIds: [], relatedEntityIds: [], setup: [], cleanup: [], provenance: [], confidence: 1 };
  return [
    { id: 'DATA-ACCOUNT', name: 'account', description: 'Existing account username', type: 'input' as const, lifecycle: 'existing' as const, strategy: 'reuse-existing' as const, ...base },
    { id: 'DATA-PASSWORD', name: 'password', description: 'Protected account password', type: 'input' as const, lifecycle: 'existing' as const, strategy: 'reuse-existing' as const, ...base },
  ];
}

function secretContext() {
  const context = testContext() as { secrets: { resolve(ref: string): Promise<{ value: string; redacted: string }> } };
  context.secrets = { async resolve(ref: string) { if (ref !== 'password') throw new Error('unknown secret'); return { value: 'test-password', redacted: '[REDACTED]' }; } };
  return context;
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

class AmbiguousSuccessSession extends PlaywrightBrowserSession {
  override async createIsolatedPage(): Promise<BrowserPage> {
    const page = await super.createIsolatedPage();
    return new Proxy(page, { get: (target, property, receiver) => {
      if (property === 'click') return async () => { throw new Error('request timed out after submit may have reached server'); };
      const method = Reflect.get(target, property, receiver);
      return typeof method === 'function' ? method.bind(target) : method;
    } }) as BrowserPage;
  }
}

class PopupLossSession extends PlaywrightBrowserSession {
  override async activatePage(pageId: string) {
    const context = await super.activatePage(pageId);
    if (context.openerPageId) {
      setTimeout(async () => { await this.closePage(pageId); }, 20);
    }
    return context;
  }
}

class PopupRecoveryAI extends RecoveryAI {
  private actions = 0;
  override async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const prompt = request.messages.map((message) => message.content).join('\n');
    if (prompt.includes('verification')) return super.generate(request);
    this.actions++;
    const elementId = this.actions === 1 ? 'el-001' : this.actions === 2 ? 'el-002' : 'el-001';
    return { data: { action: { type: 'click', elementId }, confidence: 'high', reasoning: 'Use the current observed control.' } as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}

class SessionExpirySession extends PlaywrightBrowserSession {
  private disrupted = false;
  constructor(private readonly loginUrl: string) { super(); }
  override async createIsolatedPage(): Promise<BrowserPage> {
    const page = await super.createIsolatedPage();
    return new Proxy(page, { get: (target, property, receiver) => {
      if (property === 'click') return async (...args: Parameters<BrowserPage['click']>) => {
        await target.click(...args);
        if (!this.disrupted) { this.disrupted = true; await target.goto(this.loginUrl); }
      };
      const method = Reflect.get(target, property, receiver);
      return typeof method === 'function' ? method.bind(target) : method;
    } }) as BrowserPage;
  }
}

class SessionRecoveryAI extends RecoveryAI {
  private step = 0;
  rawSecretSeen = false;
  override async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const prompt = request.messages.map((message) => message.content).join('\n');
    if (prompt.includes('test-password')) this.rawSecretSeen = true;
    if (prompt.includes('verification')) return super.generate(request);
    this.step++;
    const action = this.step === 1
      ? { type: 'click', elementId: 'el-001' }
      : this.step === 2
        ? { type: 'fill', elementId: 'el-001', value: 'demo' }
        : this.step === 3
          ? { type: 'fill', elementId: 'el-002', valueSource: 'testdata://DATA-PASSWORD' }
          : this.step === 4
            ? { type: 'click', elementId: 'el-003' }
            : { type: 'click', elementId: 'el-001' };
    return { data: { action, confidence: 'high', reasoning: 'Use the current semantic control.' } as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}

class CustomerRecoveryAI extends RecoveryAI {
  override async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const prompt = request.messages.map((message) => message.content).join('\n');
    if (prompt.includes('verification')) return { data: { assertionType: 'text-visible', expectedValue: 'Customer status: Created', confidence: 'high', reasoning: 'The reconciled resource is visible.' } as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    return { data: { action: { type: 'click', elementId: 'el-001' }, confidence: 'high', reasoning: 'Use the resource control.' } as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}
