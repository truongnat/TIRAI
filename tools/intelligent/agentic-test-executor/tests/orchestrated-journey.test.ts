import { describe, expect, it } from 'vitest';
import type { AIGenerationRequest, AIGenerationResponse, AIProvider } from 'ai-provider';
import { TestExecutionOrchestrator, TestExecutorRegistry } from 'test-execution-orchestrator';
import { PlaywrightBrowserSession } from 'ui-executor';
import { JourneyTestExecutor } from '../src/journey/journey-test-executor.js';
import { startFixtureServer } from './fixtures/fixture-server.js';

describe('Phase 2C normal orchestrator integration', () => {
  it('selects the journey executor through TestExecutionOrchestrator', async () => {
    const fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const executor = new JourneyTestExecutor({ browserSession: session, aiProvider: new OrchestratorAI(), baseUrl: `${fixture.origin}/journey-home`, allowedOrigins: [fixture.origin] });
    const registry = new TestExecutorRegistry();
    registry.register(executor);
    const result = await new TestExecutionOrchestrator({ registry, journeyEnabled: true, policy: { mode: 'execute' } }).run([testCase()]);
    expect(result.status).toBe('passed');
    expect(result.testResults[0]?.status).toBe('passed');
    expect(executor.getLastJourneyResult()?.metrics.pageTransitions).toBeGreaterThanOrEqual(2);
    expect(session.isClosed()).toBe(true);
    await fixture.close();
  }, 30_000);

  it('bridges the per-test data plan without constructor testDataItems wiring', async () => {
    const fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const executor = new JourneyTestExecutor({ browserSession: session, aiProvider: new OrchestratorAI(), baseUrl: `${fixture.origin}/journey-home`, allowedOrigins: [fixture.origin] });
    const registry = new TestExecutorRegistry();
    registry.register(executor);
    const plan = {
      schemaVersion: '1.0',
      testCases: [{ testCaseId: 'TC-ORCHESTRATED-DATA', requiredDataItemIds: ['DATA-0001'], setupItemIds: [], cleanupItemIds: [], reusableDataSetIds: [], unresolvedIds: [] }],
      dataItems: [{ id: 'DATA-0001', name: 'run marker', description: 'A generated run marker', type: 'input', lifecycle: 'generated', strategy: 'generate', constraints: [], dependencies: [], relatedTestCaseIds: ['TC-ORCHESTRATED-DATA'], relatedRequirementIds: [], relatedEntityIds: [], setup: [], cleanup: [], provenance: [], confidence: 1 }],
      dependencyGraph: [], reusableSets: [], unresolved: [], quality: {} as never,
    } as never;
    const result = await new TestExecutionOrchestrator({ registry, journeyEnabled: true, policy: { mode: 'execute' } }).run([dataTestCase()], plan);
    expect(result.testResults[0]?.status).toBe('passed');
    expect(executor.getLastJourneyResult()?.journey.runtimeBindings).toContain('runtime.DATA-0001');
    await session.close();
    await fixture.close();
  }, 30_000);

  it('blocks before browser and AI when required existing data is unavailable', async () => {
    const fixture = await startFixtureServer();
    const session = new PlaywrightBrowserSession();
    const ai = new OrchestratorAI();
    const executor = new JourneyTestExecutor({ browserSession: session, aiProvider: ai, baseUrl: `${fixture.origin}/journey-home`, allowedOrigins: [fixture.origin] });
    const registry = new TestExecutorRegistry();
    registry.register(executor);
    const plan = {
      schemaVersion: '1.0',
      testCases: [{ testCaseId: 'TC-ORCHESTRATED-BLOCKED', requiredDataItemIds: ['DATA-EXISTING'], setupItemIds: [], cleanupItemIds: [], reusableDataSetIds: [], unresolvedIds: [] }],
      dataItems: [{ id: 'DATA-EXISTING', name: 'existing account', description: 'An existing account', type: 'account', lifecycle: 'existing', strategy: 'select-existing', constraints: [], dependencies: [], relatedTestCaseIds: ['TC-ORCHESTRATED-BLOCKED'], relatedRequirementIds: [], relatedEntityIds: [], setup: [], cleanup: [], provenance: [], confidence: 1 }],
      dependencyGraph: [], reusableSets: [], unresolved: [], quality: {} as never,
    } as never;
    const result = await new TestExecutionOrchestrator({ registry, journeyEnabled: true, policy: { mode: 'execute' } }).run([blockedDataTestCase()], plan);
    expect(result.status).toBe('partial');
    expect(result.testResults[0]?.status).toBe('blocked');
    expect(session.getCounters().browsersLaunched).toBe(0);
    expect(ai.calls).toBe(0);
    await session.close();
    await fixture.close();
  }, 30_000);
});

function dataTestCase() {
  return {
    id: 'TC-ORCHESTRATED-DATA', scenarioId: 'SC-JOURNEY-DATA', requirementIds: [],
    title: 'Complete catalog item', objective: 'Complete an item with a generated run marker.', type: 'functional' as const,
    priority: 'high' as const, preconditions: [], inputs: [], dataNeeds: [],
    steps: [{ order: 1, action: 'Complete the item.' }],
    expectedResults: [{ description: 'Item status: Completed', verificationType: 'ui' as const }], cleanup: [],
    automation: { status: 'ready' as const, suggestedExecutor: 'ui' as const, reasons: [] }, provenance: [], confidence: 1,
  };
}

function blockedDataTestCase() {
  return { ...dataTestCase(), id: 'TC-ORCHESTRATED-BLOCKED', scenarioId: 'SC-JOURNEY-BLOCKED' };
}

function testCase() {
  return {
    id: 'TC-ORCHESTRATED-JOURNEY', scenarioId: 'SC-JOURNEY', requirementIds: ['REQ-JOURNEY'],
    title: 'Complete catalog item', objective: 'Complete an item across multiple application states.', type: 'functional' as const,
    priority: 'high' as const, preconditions: [], inputs: [],
    steps: [{ order: 1, action: 'Complete the item and verify the final state.' }],
    expectedResults: [{ description: 'Item status: Completed', verificationType: 'ui' as const }], cleanup: [],
    automation: { status: 'ready' as const, suggestedExecutor: 'ui' as const, reasons: [] }, provenance: [], confidence: 1,
  };
}

class OrchestratorAI implements AIProvider {
  readonly name = 'orchestrator-fake';
  readonly capabilities = { jsonMode: true, toolCalling: false, vision: false };
  calls = 0;
  async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    this.calls++;
    const prompt = request.messages.map((message) => message.content).join('\n');
    const data = prompt.includes('verification')
      ? { assertionType: 'text-visible', expectedValue: 'Item status: Completed', confidence: 'high', reasoning: 'Final state is visible.' }
      : { action: { type: 'click', elementId: 'el-001' }, confidence: 'high', reasoning: 'Ground the next observed action.' };
    return { data: data as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}
