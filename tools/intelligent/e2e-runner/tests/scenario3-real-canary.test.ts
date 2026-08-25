import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeepSeekProvider } from 'ai-provider';
import { TestExecutionOrchestrator, TestExecutorRegistry } from 'test-execution-orchestrator';
import { JourneyTestExecutor } from '../../agentic-test-executor/src/journey/journey-test-executor.js';
import { PlaywrightBrowserSession } from 'ui-executor';
import { Scenario3Pipeline } from '../src/scenario3.js';
import { startFixtureServer } from '../../agentic-test-executor/tests/fixtures/fixture-server.js';

const enabled = process.env.RUN_SCENARIO3_REAL_CANARY === 'true';

describe.skipIf(!enabled)('Scenario 3 native real canary', () => {
  it('runs specification through planning, Scenario 2 and Chromium', async () => {
    if (!process.env.DEEPSEEK_API_KEY) throw new Error('BLOCKED_PROVIDER_CONFIGURATION');
    const fixture = await startFixtureServer();
    const provider = new DeepSeekProvider({ model: 'deepseek-v4-flash', maxRetries: 1 });
    const session = new PlaywrightBrowserSession();
    const executor = new JourneyTestExecutor({
      browserSession: session,
      aiProvider: provider,
      baseUrl: `${fixture.origin}/journey-home`,
      allowedOrigins: [fixture.origin],
      policy: { maxJourneyDecisions: 10, maxAgentCalls: 20, maxObservationRounds: 20 },
    });
    const registry = new TestExecutorRegistry();
    registry.register(executor);
    const orchestrator = new TestExecutionOrchestrator({ registry, journeyEnabled: true, policy: { mode: 'execute' } });
    const result = await new Scenario3Pipeline({ aiProvider: provider, orchestrator }).run({ semanticIR: semanticIR() });
    const metrics = executor.getLastJourneyResult()?.metrics;
    const report = [
      '# TIRAI — SCENARIO 3 NATIVE REAL CANARY', '',
      `Status: ${result.status.toUpperCase()}`,
      `Requirements: ${result.requirements.requirements.length}`,
      `Scenarios: ${result.testPlan.scenarios.length}`,
      `TestCases: ${result.testPlan.testCases.length}`,
      `DataItems: ${result.dataPlan?.dataItems.length ?? 0}`,
      `TraceNodes: ${result.trace.nodes.length}`,
      `TraceEdges: ${result.trace.edges.length}`,
      `Orphans: ${result.trace.orphanEvidenceIds.length}`,
      `Journey states: ${metrics?.uniqueSemanticStates ?? 0}`,
      `Journey actions: ${metrics?.actions ?? 0}`,
      `Chromium lifecycle: ${session.getCounters().browsersLaunched - session.getCounters().browsersClosed + session.getCounters().pagesCreated - session.getCounters().pagesClosed}`,
    ].join('\n');
    const outputDir = join(process.cwd(), 'output/scenario-3-final-acceptance');
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, 'real-canary-report.md'), report, 'utf8');
    await fixture.close();
    expect(result.status).toBe('passed');
    expect(result.testPlan.testCases.length).toBeGreaterThan(0);
    expect(result.trace.orphanEvidenceIds).toEqual([]);
  }, 240_000);
});

function semanticIR() {
  const provenance = [{ contextId: 'ctx-scenario3-journey', sheet: 'Acceptance Specification', ranges: ['A1:F12'] }];
  return {
    schemaVersion: '1.0', status: 'complete' as const,
    document: { title: 'Catalog completion', summary: 'A user completes the available catalog item.', provenance },
    sections: [{ id: 'sec-1', title: 'Completion flow', description: 'Complete a catalog item.', provenance, confidence: 1 }],
    entities: [{ id: 'entity-item', name: 'catalog item', type: 'business-entity', description: 'The item shown in the catalog.', provenance, confidence: 1 }],
    flows: [{ id: 'flow-1', name: 'Complete catalog item', description: 'Open catalog, open item, and complete it.', steps: [
      { order: 1, action: 'Open the catalog', provenance },
      { order: 2, action: 'Open the available item', provenance },
      { order: 3, action: 'Complete the item', provenance },
    ], provenance, confidence: 1 }],
    rules: [{ id: 'rule-1', type: 'state-transition', statement: 'The item status changes from Pending to Completed.', provenance, confidence: 1 }],
    relationships: [], unresolved: [], analysis: { provider: 'fixture', model: 'fixture', promptVersion: '1', chunksAnalyzed: 1, aiRequests: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, warnings: [] },
  };
}
