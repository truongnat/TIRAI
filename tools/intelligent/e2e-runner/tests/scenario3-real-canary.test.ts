import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeepSeekProvider, type AIProvider, type AIGenerationRequest, type AIGenerationResponse } from 'ai-provider';
import { TestExecutionOrchestrator, TestExecutorRegistry } from 'test-execution-orchestrator';
import { JourneyTestExecutor } from '../../agentic-test-executor/src/journey/journey-test-executor.js';
import type { VerificationRuntime } from '../../agentic-test-executor/src/verification.js';
import { PlaywrightBrowserSession } from 'ui-executor';
import { Scenario3Pipeline } from '../src/scenario3.js';
import { startFixtureServer } from '../../agentic-test-executor/tests/fixtures/fixture-server.js';

const enabled = process.env.RUN_SCENARIO3_REAL_CANARY === 'true';

describe.skipIf(!enabled)('Scenario 3 native real canary', () => {
  it('runs specification through planning, Scenario 2 and Chromium', async () => {
    if (!process.env.DEEPSEEK_API_KEY) throw new Error('BLOCKED_PROVIDER_CONFIGURATION');
    const progressPath = join(process.cwd(), 'output/scenario-3-final-acceptance/real-canary-progress.jsonl');
    mkdirSync(join(process.cwd(), 'output/scenario-3-final-acceptance'), { recursive: true });
    writeFileSync(progressPath, '');
    const mark = (message: string) => appendFileSync(progressPath, `${JSON.stringify({ stage: 'PREFLIGHT', message, at: new Date().toISOString() })}\n`);
    mark('before-fixture');
    const fixture = await startFixtureServer();
    mark('after-fixture');
    const provider = new CountingProvider(new DeepSeekProvider({ model: 'deepseek-v4-flash', maxRetries: 1 }));
    const session = new PlaywrightBrowserSession();
    const executor = new JourneyTestExecutor({
      browserSession: session,
      aiProvider: provider,
      baseUrl: `${fixture.origin}/journey-home`,
      allowedOrigins: [fixture.origin],
      capabilities: { browser: 'AVAILABLE', database: 'UNAVAILABLE', api: 'AVAILABLE', source: 'UNAVAILABLE', secrets: 'UNAVAILABLE', files: 'UNAVAILABLE' },
      capabilityInventory: {
        browser: {
          available: true,
          discoverRuntimeState: true,
          discovery: async () => ({
            value: 'ITEM-001',
            bindingRef: 'runtime.order.item',
            evidence: [{ kind: 'fixture-browser-discovery', description: 'Disposable acceptance item discovered in the fixture.' }],
          }),
        },
      },
      policy: { maxJourneyDecisions: 10, maxAgentCalls: 20, maxObservationRounds: 20 },
      verification: makeVerificationRuntime(fixture.origin),
    });
    const registry = new TestExecutorRegistry();
    registry.register(executor);
    const orchestrator = new TestExecutionOrchestrator({ registry, journeyEnabled: true, policy: { mode: 'execute' } });
    mark('after-runtime-setup');
    const fixtureProbe = await fetch(`${fixture.origin}/journey-home`);
    mark(`fixture-response-${fixtureProbe.status}`);
    if (!fixtureProbe.ok) throw new Error(`FIXTURE_PREFLIGHT_${fixtureProbe.status}`);
    const result = await new Scenario3Pipeline({ aiProvider: provider, orchestrator }).run({
      semanticIR: semanticIR(),
      onProgress: (event) => {
        provider.stage = event.stage;
        appendFileSync(progressPath, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`);
      },
    });
    const metrics = executor.getLastJourneyResult()?.metrics;
    const journeyResult = executor.getLastJourneyResult();
    const report = [
      '# TIRAI — SCENARIO 3 NATIVE REAL CANARY', '',
      `Status: ${result.status.toUpperCase()}`,
      `Requirements: ${result.requirements?.requirements.length ?? 0}`,
      `Scenarios: ${result.testPlan?.scenarios.length ?? 0}`,
      `TestCases: ${result.testPlan?.testCases.length ?? 0}`,
      `DataItems: ${result.dataPlan?.dataItems.length ?? 0}`,
      `TraceNodes: ${result.trace.nodes.length}`,
      `TraceEdges: ${result.trace.edges.length}`,
      `Orphans: ${result.trace.orphanEvidenceIds.length}`,
      `Journey states: ${metrics?.uniqueSemanticStates ?? 0}`,
      `Journey actions: ${metrics?.actions ?? 0}`,
      `Journey terminal: ${journeyResult?.status ?? 'not-run'} ${journeyResult?.error?.code ?? ''} ${journeyResult?.error?.message ?? ''}`,
      `Chromium lifecycle: ${session.getCounters().browsersLaunched - session.getCounters().browsersClosed + session.getCounters().pagesCreated - session.getCounters().pagesClosed}`,
      `AI calls: ${provider.calls}`,
      `AI tokens: ${provider.totalTokens}`,
      `AI calls by stage: ${JSON.stringify(provider.callsByStage)}`,
      `Execution status: ${result.execution?.status ?? 'not-run'}`,
      `Execution summary: ${JSON.stringify(result.execution?.summary ?? {})}`,
      `Execution results: ${JSON.stringify(result.execution?.testResults?.map((test) => ({ id: test.testCaseId, status: test.status, phase: test.phase, errors: test.errors, warnings: test.warnings, cleanup: test.cleanup, bindings: test.runtimeBindings })) ?? [])}`,
      `Test case data needs: ${JSON.stringify(result.testPlan?.testCases?.map((test) => ({ id: test.id, dataNeeds: test.dataNeeds.map((need) => need.description), expectedResults: test.expectedResults.map((expected) => ({ description: expected.description, verificationType: expected.verificationType, intent: expected.verificationIntent })) })) ?? [])} `,
      `Data plan test cases: ${JSON.stringify(result.dataPlan?.testCases ?? [])}`,
      `Data plan items: ${JSON.stringify(result.dataPlan?.dataItems?.map((item) => ({ id: item.id, strategy: item.strategy, lifecycle: item.lifecycle, relatedTestCaseIds: item.relatedTestCaseIds })) ?? [])}`,
      `Warnings: ${JSON.stringify(result.warnings)}`,
    ].join('\n');
    const outputDir = join(process.cwd(), 'output/scenario-3-final-acceptance');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'real-canary-report.md'), report, 'utf8');
    await fixture.close();
    expect(result.status).toBe('passed');
    expect(result.testPlan.testCases.length).toBeGreaterThan(0);
    expect(result.trace.orphanEvidenceIds).toEqual([]);
  }, 420_000);
});

class CountingProvider implements AIProvider {
  readonly name: string;
  readonly capabilities;
  calls = 0;
  totalTokens = 0;
  stage = 'PREFLIGHT';
  callsByStage: Record<string, number> = {};

  constructor(private readonly inner: DeepSeekProvider) {
    this.name = inner.name;
    this.capabilities = inner.capabilities;
  }

  async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const response = await this.inner.generate(request);
    this.calls++;
    this.totalTokens += response.usage?.totalTokens ?? 0;
    this.callsByStage[this.stage] = (this.callsByStage[this.stage] ?? 0) + 1;
    return response;
  }
}

function semanticIR() {
  const provenance = [{ contextId: 'ctx-scenario3-journey', sheet: 'Acceptance Specification', ranges: ['A1:F12'] }];
  return {
    schemaVersion: '1.0', status: 'complete' as const,
    document: { title: 'One catalog completion requirement', summary: 'Exactly one requirement and exactly one atomic acceptance test: an existing approved catalog item can be completed. The required business proof is persisted status COMPLETED; the visible status Completed is observed as supporting UI evidence. Do not split this into separate test cases.', provenance },
    sections: [{ id: 'sec-1', title: 'Single requirement', description: 'Only the completion requirement below is in scope.', provenance, confidence: 1 }],
    entities: [],
    flows: [{ id: 'flow-1', name: 'Complete approved catalog item', description: 'For the existing approved catalog item, open the catalog, open the item, and complete it. The UI must show Completed and the persisted business status must be COMPLETED.', steps: [
      { order: 1, action: 'Use exactly one atomic test case: complete the existing approved catalog item, verify persisted business status COMPLETED, and observe visible status Completed as supporting UI evidence. Do not create separate test cases for evidence layers.', provenance },
    ], provenance, confidence: 1 }],
    rules: [], relationships: [], unresolved: [], analysis: { provider: 'fixture', model: 'fixture', promptVersion: '1', chunksAnalyzed: 1, aiRequests: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, warnings: [] },
  };
}

function makeVerificationRuntime(origin: string): VerificationRuntime {
  return {
    plan: {
      needs: [{ id: 'item-status', subject: { entityType: 'item', businessKey: 'ITEM-001' }, property: 'status', expectation: { kind: 'equals', value: 'COMPLETED' }, requiredSources: ['UI', 'API'], authority: 'API' }],
      acquisitions: ['UI', 'API'],
    },
    sources: {
      UI: { source: 'UI', readOnly: true, acquire: async ({ observation }) => observation && /Item status: Completed/i.test(observation.pageText) ? [{ source: 'UI', acquisitionRef: 'browser-observation', entityKey: 'ITEM-001', property: 'status', rawValue: 'Completed', normalizedValue: 'COMPLETED', mappingKnown: true, provenance: { kind: 'browser-observation', reference: 'scenario3-final-state' } }] : [] },
      API: { source: 'API', readOnly: true, acquire: async () => { const response = await fetch(`${origin}/verification/item`); const body = await response.json() as { businessKey: string; status: string }; return [{ source: 'API', acquisitionRef: 'GET /verification/item', entityKey: body.businessKey, property: 'status', rawValue: body.status, normalizedValue: body.status, mappingKnown: true, provenance: { kind: 'fixture-api-read', reference: 'GET /verification/item' } }]; } },
    },
  };
}
