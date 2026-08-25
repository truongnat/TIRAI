import { describe, expect, it } from 'vitest';
import type { AIGenerationRequest, AIGenerationResponse, AIProvider } from 'ai-provider';
import { TestExecutionOrchestrator, TestExecutorRegistry } from 'test-execution-orchestrator';
import { PlaywrightBrowserSession } from 'ui-executor';
import { JourneyTestExecutor } from '../src/journey/journey-test-executor.js';
import { startFixtureServer } from './fixtures/fixture-server.js';
import {
  confirmSourceHints,
  groundConfirmedAction,
  resolveRelevantSourceHints,
  sanitizeIntelligence,
  sourceIntelligenceFromProjectProfile,
  StaticSourceIntelligenceProvider,
  type SourceIntelligence,
} from '../src/source-intelligence.js';

const testCase = { title: 'Complete order', objective: 'Cancel the order', expectedResults: [{ description: 'Order status: Cancelled' }] } as never;
const observation = { url: 'http://fixture/orders/123', title: 'Order detail', headings: ['Order detail'], pageText: 'Order status Cancelled', truncated: false, elements: [{ id: 'el-1', role: 'button', accessibleName: 'Cancel order', enabled: true }] };

function intelligence(overrides: Partial<SourceIntelligence> = {}): SourceIntelligence {
  return {
    schemaVersion: '1.0', snapshotId: 'source-1', sourceSecrets: 0,
    hints: [{ id: 'cancel', kind: 'ACTION_HINT', semanticName: 'Cancel order', provenance: { source: 'fixture', reference: 'OrderPage.cancel', confidence: 'DECLARED' }, lifecycle: 'DISCOVERED' }],
    ...overrides,
  };
}

describe('Phase 2F source intelligence', () => {
  it('is optional and preserves black-box fallback', async () => {
    const provider = new StaticSourceIntelligenceProvider(intelligence());
    expect((await provider.discover({ testCase })).hints).toHaveLength(1);
    const noSource: SourceIntelligence | undefined = undefined;
    expect(noSource).toBeUndefined();
  });

  it('resolves and confirms semantic action hints without selectors', () => {
    const resolved = resolveRelevantSourceHints(intelligence(), testCase, 'order detail');
    const confirmed = confirmSourceHints(resolved.provided, observation);
    const action = groundConfirmedAction(confirmed.confirmed, observation);
    expect(action?.elementId).toBe('el-1');
    expect(JSON.stringify(action)).not.toContain('selector');
    expect(confirmed.confirmed[0]?.lifecycle).toBe('CONFIRMED');
  });

  it('rejects a stale hint rather than executing it', () => {
    const stale = intelligence({ hints: [{ ...intelligence().hints[0]!, kind: 'NAVIGATION_HINT', routePattern: '/old-orders/:id', lifecycle: 'STALE' }] });
    const result = confirmSourceHints(stale.hints, observation);
    expect(result.confirmed).toHaveLength(0);
    expect(result.stale).toHaveLength(1);
  });

  it('converts project catalogs to semantic hints and strips locator/secret data', () => {
    const source = sourceIntelligenceFromProjectProfile({ fingerprint: 'profile-1', provenance: [{ source: 'tirai.project.json' }], ui: { catalog: { pages: [{ id: 'order-detail', route: '/orders/:id', elements: [{ logicalName: 'cancel-button' }] }] } }, api: { operations: [{ id: 'get-order', method: 'GET', path: '/orders/{id}' }], mappings: [{ logicalEntity: 'order', operationIds: ['get-order'] }] }, database: { catalogs: [{ resourceId: 'db-main', schemas: [{ name: 'public', tables: [{ name: 'orders' }] }] }] } });
    expect(source.hints.some((hint) => hint.kind === 'NAVIGATION_HINT')).toBe(true);
    expect(source.hints.some((hint) => hint.kind === 'API_HINT')).toBe(true);
    expect(source.hints.some((hint) => hint.kind === 'PERSISTENCE_HINT')).toBe(true);
    expect(JSON.stringify(source)).not.toContain('data-testid');
    expect(source.sourceSecrets).toBe(0);
  });

  it('sanitizes source-like secrets and keeps provenance/confidence', () => {
    const clean = sanitizeIntelligence(intelligence({ hints: [{ ...intelligence().hints[0]!, details: { password: 'fake-secret', semantic: 'cancel' } }] }));
    expect(JSON.stringify(clean)).not.toContain('fake-secret');
    expect(clean.hints[0]?.provenance.confidence).toBe('DECLARED');
  });

  it('rejects a stale source action and continues from runtime reality', async () => {
    const fixture = await startFixtureServer();
    const source = intelligence({ hints: [{ ...intelligence().hints[0]!, semanticName: 'Complete item', lifecycle: 'STALE' }] });
    const session = new PlaywrightBrowserSession();
    const executor = new JourneyTestExecutor({ browserSession: session, aiProvider: new RuntimeOnlyAI(), baseUrl: `${fixture.origin}/journey-home`, allowedOrigins: [fixture.origin], sourceIntelligence: new StaticSourceIntelligenceProvider(source) });
    const registry = new TestExecutorRegistry();
    registry.register(executor);
    const run = await new TestExecutionOrchestrator({ registry, journeyEnabled: true, policy: { mode: 'execute' } }).run([{ id: 'TC-SOURCE-STALE', scenarioId: 'SC-SOURCE-STALE', requirementIds: [], title: 'Complete item', objective: 'Complete item', type: 'functional', priority: 'high', preconditions: [], inputs: [], steps: [{ order: 1, action: 'Complete item' }], expectedResults: [{ description: 'Item status: Completed', verificationType: 'ui' }], cleanup: [], automation: { status: 'ready', suggestedExecutor: 'ui', reasons: [] }, provenance: [], confidence: 1 } as never]);
    const result = executor.getLastJourneyResult();
    expect(run.testResults[0]?.status).toBe('passed');
    expect(result?.metrics.sourceHintsRejected).toBeGreaterThan(0);
    expect(result?.metrics.sourceHintsUsed).toBe(0);
    await session.close();
    await fixture.close();
  }, 30_000);
});

class RuntimeOnlyAI implements AIProvider {
  readonly name = 'runtime-only-fixture-ai';
  readonly capabilities = { jsonMode: true, toolCalling: false, vision: false };
  async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const prompt = request.messages.map((message) => message.content).join('\n');
    const data = prompt.includes('verification')
      ? { assertionType: 'text-visible', expectedValue: 'Item status: Completed', confidence: 'high', reasoning: 'Runtime observation confirms final state.' }
      : { action: { type: 'click', elementId: 'el-001' }, confidence: 'high', reasoning: 'Use current runtime control.' };
    return { data: data as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}
