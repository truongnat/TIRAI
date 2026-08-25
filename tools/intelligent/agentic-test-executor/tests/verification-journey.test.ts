import { describe, expect, it } from 'vitest';
import type { AIGenerationRequest, AIGenerationResponse, AIProvider } from 'ai-provider';
import { TestExecutionOrchestrator, TestExecutorRegistry } from 'test-execution-orchestrator';
import { PlaywrightBrowserSession } from 'ui-executor';
import { JourneyTestExecutor } from '../src/journey/journey-test-executor.js';
import type { VerificationRuntime } from '../src/verification.js';
import { startFixtureServer } from './fixtures/fixture-server.js';

describe('Phase 2E browser contradiction acceptance', () => {
  it('fails when UI reports success but the correlated backend remains ACTIVE', async () => {
    const fixture = await startFixtureServer();
    const verification = makeVerificationRuntime(fixture.origin);
    const session = new PlaywrightBrowserSession();
    const executor = new JourneyTestExecutor({ browserSession: session, aiProvider: new VerificationAI(), baseUrl: `${fixture.origin}/journey-detail`, allowedOrigins: [fixture.origin], verification });
    const registry = new TestExecutorRegistry();
    registry.register(executor);
    const run = await new TestExecutionOrchestrator({ registry, journeyEnabled: true, policy: { mode: 'execute' } }).run([testCase()]);
    expect(run.testResults[0]?.status).toBe('failed');
    expect(executor.getLastJourneyResult()?.verification?.status).toBe('CONTRADICTED');
    expect(session.isClosed()).toBe(true);
    await fixture.close();
  }, 30_000);
});

function testCase() {
  return {
    id: 'TC-VERIFY-CONTRADICTION', scenarioId: 'SC-VERIFY-CONTRADICTION', requirementIds: [], title: 'Complete item', objective: 'Complete item and verify persisted status.', type: 'functional' as const, priority: 'high' as const, preconditions: [], inputs: [],
    steps: [{ order: 1, action: 'Complete the item.' }], expectedResults: [{ description: 'Item status: Completed', verificationType: 'ui' as const }], cleanup: [], automation: { status: 'ready' as const, suggestedExecutor: 'ui' as const, reasons: [] }, provenance: [], confidence: 1,
  };
}

function makeVerificationRuntime(origin: string): VerificationRuntime {
  return {
    plan: { needs: [{ id: 'item-status', subject: { entityType: 'item', businessKey: 'ITEM-001' }, property: 'status', expectation: { kind: 'equals', value: 'COMPLETED' }, requiredSources: ['UI', 'API'], authority: 'API' }], acquisitions: ['UI', 'API'] },
    sources: {
      UI: { source: 'UI', readOnly: true, acquire: async ({ observation }) => observation && /Item status: Completed/i.test(observation.pageText) ? [{ source: 'UI', acquisitionRef: 'browser-observation', entityKey: 'ITEM-001', property: 'status', rawValue: 'Completed', normalizedValue: 'COMPLETED', mappingKnown: true, provenance: { kind: 'browser-observation', reference: 'final-state' } }] : [] },
      API: { source: 'API', readOnly: true, acquire: async () => { const response = await fetch(`${origin}/verification/item?wrong=1`); const body = await response.json() as { businessKey: string; status: string }; return [{ source: 'API', acquisitionRef: 'GET /verification/item', entityKey: body.businessKey, property: 'status', rawValue: body.status, normalizedValue: body.status, mappingKnown: true, provenance: { kind: 'fixture-api-read', reference: 'GET /verification/item' } }]; } },
    },
  };
}

class VerificationAI implements AIProvider {
  readonly name = 'verification-fixture-ai';
  readonly capabilities = { jsonMode: true, toolCalling: false, vision: false };
  async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const prompt = request.messages.map((message) => message.content).join('\n');
    const data = prompt.includes('verification')
      ? { assertionType: 'text-visible', expectedValue: 'Item status: Completed', confidence: 'high', reasoning: 'Visible completion state.' }
      : { action: { type: 'click', elementId: 'el-001' }, confidence: 'high', reasoning: 'Use the observed completion control.' };
    return { data: data as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}
