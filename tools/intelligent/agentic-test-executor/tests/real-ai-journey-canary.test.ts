import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DeepSeekProvider, type AIGenerationRequest, type AIGenerationResponse, type AIProvider } from 'ai-provider';
import { InMemoryBindingStore } from 'execution-engine';
import { InMemoryEvidenceCollector } from 'test-execution-orchestrator';
import { PlaywrightBrowserSession } from 'ui-executor';
import { JourneyAgent } from '../src/journey/journey-agent.js';
import { startFixtureServer, type FixtureServer } from './fixtures/fixture-server.js';

const enabled = process.env.RUN_REAL_AI_JOURNEY_CANARY === 'true';

describe.skipIf(!enabled)('TIRAI real AI multi-page journey canary', () => {
  let fixture: FixtureServer;

  afterAll(async () => {
    await fixture?.close();
  });

  it('completes a real three-route journey with DeepSeek and Chromium', async () => {
    if (!process.env.DEEPSEEK_API_KEY) throw new Error('BLOCKED_PROVIDER_CONFIGURATION');
    fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const provider = new AuditedProvider(new DeepSeekProvider({ model: 'deepseek-v4-flash', maxRetries: 1 }));
    const agent = new JourneyAgent({
      browserSession: session,
      aiProvider: provider,
      baseUrl: `${fixture.origin}/journey-home`,
      allowedOrigins: [fixture.origin],
      policy: { maxJourneyDecisions: 8, maxAgentCalls: 20, maxObservationRounds: 20 },
    });
    const evidence = new InMemoryEvidenceCollector();
    const context = {
      mode: 'live',
      policy: { maxRetries: 0, timeoutMs: 30_000, parallelism: 1, stopOnFailure: false },
      bindings: new InMemoryBindingStore(),
      secrets: { async resolve(): Promise<never> { throw new Error('no secret capability in journey canary'); } },
      evidence,
      audit: { record: async () => {} },
      clock: { now: () => new Date().toISOString() },
      runId: 'RUN-REAL-AI-JOURNEY',
      testCaseId: 'TC-REAL-AI-JOURNEY',
      environmentId: 'ENV-LOCAL-DISPOSABLE',
    } as never;

    let result;
    try {
      result = await agent.execute(makeJourneyTestCase(), context);
    } finally {
      await agent.cleanup();
    }
    const lifecycle = session.getCounters();
    const report = [
      '# TIRAI — REAL AI MULTI-PAGE JOURNEY CANARY',
      '',
      `Status: ${result.status.toUpperCase()}`,
      'Provider: DeepSeek',
      'Model: deepseek-v4-flash',
      `AI calls: ${provider.calls}`,
      `Tokens: ${provider.inputTokens} input / ${provider.outputTokens} output / ${provider.totalTokens} total`,
      `Semantic states: ${result.metrics.uniqueSemanticStates}`,
      `Page transitions: ${result.metrics.pageTransitions}`,
      `Actions: ${result.metrics.actions}`,
      `Replans: ${result.metrics.journeyReplans}`,
      `Loop detections: ${result.metrics.loopDetections}`,
      `Generated selectors: 0`,
      `External navigation: 0`,
      `Chromium lifecycle leaks: ${lifecycle.browsersLaunched - lifecycle.browsersClosed + lifecycle.pagesCreated - lifecycle.pagesClosed}`,
      `Evidence: ${result.evidence.length}`,
    ].join('\n');
    const outputDir = join(process.cwd(), '../../../output/agentic-test-executor/real-ai-journey-canary');
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, 'acceptance-report.md'), report, 'utf8');
    await writeFile(join(outputDir, 'metrics.json'), JSON.stringify({ result: result.metrics, provider: { calls: provider.calls, inputTokens: provider.inputTokens, outputTokens: provider.outputTokens, totalTokens: provider.totalTokens }, browser: lifecycle }, null, 2), 'utf8');

    expect(result.status).toBe('passed');
    expect(result.metrics.uniqueSemanticStates).toBeGreaterThanOrEqual(3);
    expect(result.metrics.pageTransitions).toBeGreaterThanOrEqual(2);
    expect(result.metrics.actions).toBeGreaterThanOrEqual(3);
    expect(result.metrics.loopDetections).toBe(0);
    expect(lifecycle.browsersLaunched).toBe(lifecycle.browsersClosed);
    expect(lifecycle.pagesCreated).toBe(lifecycle.pagesClosed);
    expect(provider.rawSecretInPrompt).toBe(false);
  }, 180_000);
});

function makeJourneyTestCase() {
  return {
    id: 'TC-REAL-AI-JOURNEY', scenarioId: 'SC-REAL-AI-JOURNEY', requirementIds: ['REQ-REAL-AI-JOURNEY'],
    title: 'Complete catalog item', objective: 'Complete an item across workspace, catalog, and detail states.',
    type: 'functional' as const, priority: 'high' as const, preconditions: [], inputs: [],
    steps: [{ order: 1, action: 'Complete the item across the application journey.' }],
    expectedResults: [{ description: 'Item status: Completed', verificationType: 'ui' }],
    cleanup: [], automation: { status: 'ready' as const, suggestedExecutor: 'ui', reasons: [] }, provenance: [], confidence: 1,
  } as never;
}

class AuditedProvider implements AIProvider {
  readonly name: string;
  readonly capabilities;
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;
  totalTokens = 0;
  rawSecretInPrompt = false;

  constructor(private readonly inner: AIProvider) {
    this.name = inner.name;
    this.capabilities = inner.capabilities;
  }

  async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const prompt = request.messages.map((message) => message.content).join('\n');
    const secret = process.env.DEEPSEEK_API_KEY;
    if (secret && prompt.includes(secret)) {
      this.rawSecretInPrompt = true;
      throw new Error('STOP_RAW_SECRET_IN_AI_PROMPT');
    }
    const response = await this.inner.generate(request);
    this.calls++;
    this.inputTokens += response.usage?.inputTokens ?? 0;
    this.outputTokens += response.usage?.outputTokens ?? 0;
    this.totalTokens += response.usage?.totalTokens ?? 0;
    return response;
  }
}
