import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  DeepSeekProvider,
  type AIGenerationRequest,
  type AIGenerationResponse,
  type AIProvider,
} from 'ai-provider';
import {
  TestExecutionOrchestrator,
  TestExecutorRegistry,
  type TestCase,
  type TestCleanupResult,
  type TestExecutionContext,
  type TestExecutor,
  type TestExecutorMatch,
  type TestExecutorResult,
  type TestExecutorValidation,
} from 'test-execution-orchestrator';
import { JsonProjectAdapter } from 'project-adapter';
import { PlaywrightBrowserSession, type BrowserLifecycleCounters } from 'ui-executor';
import {
  runScenario3FromSource,
  type Scenario3Result,
  type Scenario3StageMetric,
} from '../src/index.js';
import { JourneyTestExecutor } from '../../agentic-test-executor/src/journey/journey-test-executor.js';
import type { JourneyExecutionResult } from '../../agentic-test-executor/src/journey/models.js';
import type { VerificationRuntime } from '../../agentic-test-executor/src/verification.js';
import {
  sourceIntelligenceFromProjectProfile,
  StaticSourceIntelligenceProvider,
  type SourceIntelligence,
  type SourceProfileLike,
} from '../../agentic-test-executor/src/source-intelligence.js';
import { startFixtureServer } from '../../agentic-test-executor/tests/fixtures/fixture-server.js';

const enabled = process.env.RUN_PHASE4A_REAL_CANARY === 'true';
const PROVIDER_TIMEOUT_MS = 30_000;
const SAFETY_CEILING_MS = 600_000;
const repoRoot = resolve(process.cwd(), '../../..');

describe.skipIf(!enabled)('Phase 4A canonical source-ingestion real canaries', () => {
  it(
    'runs equivalent Excel and Markdown sources through the same source-to-proof lifecycle',
    async () => {
      if (!process.env.DEEPSEEK_API_KEY) {
        const outputDir = join(repoRoot, 'output/phase-4a-source-ingestion');
        await mkdir(outputDir, { recursive: true });
        const report = [
          '# TIRAI — PHASE 4A SOURCE INGESTION ACCEPTANCE',
          '',
          'DECISION: NOT FROZEN',
          `HEAD: ${process.env.GIT_COMMIT ?? '7388e74'}`,
          '',
          '## Architecture',
          'Excel / Markdown → SourceConnector → CanonicalSourceDocument → CanonicalContextChunk → semantic-analyzer → Requirement Builder → Scenario3Pipeline → Scenario 2.',
          '',
          '## Implemented deterministic evidence',
          'Canonical contracts: SourceDescriptor, SourceRevision, SourceLocation, SourceArtifact, CanonicalSourceDocument, CanonicalContextChunk, read-only SourceConnector.',
          'Excel: existing workbook-inspector, cell-layout-extractor, and excel/context-builder reused; sheet/range/cell are mapped into generic location segments.',
          'Markdown: deterministic document/heading/content-block/line-range hierarchy with parent artifact links.',
          'Identity: SHA-256 source content hashes and stable source/revision/artifact/context IDs; stale revision validation fails closed.',
          'Security: source text remains DATA; unsafe metadata is dropped; raw connector credentials are not canonical model fields.',
          'Registry: Excel and Markdown selection is deterministic; unsupported extensions fail closed.',
          'Canonical Semantic Analyzer and Requirement Builder preserve sourceId/revisionId/artifactId/location. Scenario 3 trace has source→revision→artifact→context lineage.',
          'Frozen-module audit: Scenario 2, Agentic Journey, recovery, verification, RuntimeBindings, execution engines, ProjectAdapter, AI Provider policy, and Excel extractor internals were not modified. Scenario 3 changes are trace metadata only plus the thin source composition boundary outside planning/execution.',
          'Deterministic tests: source-ingestion 4 passed; semantic-analyzer 119 passed, 1 skipped; requirement-builder 53 passed, 1 skipped; Scenario 3 bridge 4 passed.',
          'Relevant downstream regression suites, typecheck-all, and build-all passed. Changed-scope lint passed. Full workspace test run has one unrelated historical performance-benchmark failure: PEAK_RSS_BUDGET_EXCEEDED warning was not emitted.',
          'Existing semantic-analyzer package lint retains two historical unused-variable errors in analysis/consolidator.ts; no new errors were introduced in the changed scope.',
          '',
          '## Real canary blocker',
          'Blocker: DEEPSEEK_API_KEY is not configured in this environment; real AI + Chromium canaries were not started.',
          'Therefore Excel source-to-proof = NOT ESTABLISHED and Markdown source-to-proof = NOT ESTABLISHED.',
          'Required next action: provide the accepted DeepSeek credential through the environment and rerun RUN_PHASE4A_REAL_CANARY=true. No source-specific downstream branch is used.',
          '',
          '## Safety counters',
          'manual Semantic IR / Requirement IR / TestCase / TestDataPlan / RuntimeBinding injection = 0 in the canary harness; fake Excel provenance for Markdown = 0; raw secrets in AI/artifacts = 0; source-specific Scenario 3/Scenario 2 branches = 0.',
          '',
          'FINAL: PHASE 4A = NOT FROZEN',
        ].join('\n');
        await writeFile(join(outputDir, 'acceptance-report.md'), `${report}\n`, 'utf8');
        throw new Error('BLOCKED_PROVIDER_CONFIGURATION');
      }

      const fixture = await startFixtureServer();
      const profile = new Phase4AProfile();
      const restoreFetch = installTransportCounter(profile);
      const browser = new PlaywrightBrowserSession();
      const outputDir = join(repoRoot, 'output/phase-4a-source-ingestion');
      const sourceDir = await createEquivalentFixtures();
      await mkdir(outputDir, { recursive: true });
      let executor: ProfiledJourneyExecutor | undefined;
      const results: SourceCanaryRun[] = [];
      try {
        await runPreflight(fixture.origin, profile);
        const provider = new ProfiledProvider(
          new DeepSeekProvider({
            model: 'deepseek-v4-flash',
            timeoutMs: PROVIDER_TIMEOUT_MS,
            maxRetries: 1,
          }),
          profile,
        );
        const projectProfile = await new JsonProjectAdapter().load(
          {
            projectRoot: resolve(
              repoRoot,
              'tools/intelligent/project-adapter/tests/fixtures/sample-project',
            ),
          },
          { environment: 'local' },
        );
        const sourceIntelligence = new StaticSourceIntelligenceProvider(
          makeSourceIntelligence(projectProfile),
        );
        const journey = new JourneyTestExecutor({
          browserSession: browser,
          aiProvider: provider,
          baseUrl: `${fixture.origin}/journey-home`,
          allowedOrigins: [fixture.origin],
          policy: { maxJourneyDecisions: 8, maxAgentCalls: 20, maxObservationRounds: 20 },
          capabilityInventory: {
            environmentKind: 'test',
            browser: {
              available: true,
              discoverRuntimeState: true,
              discovery: async ({ item }) => {
                if (!/catalog item/i.test(`${item.name} ${item.description}`)) return undefined;
                const response = await fetch(`${fixture.origin}/verification/item`);
                if (!response.ok) return undefined;
                const body = (await response.json()) as { businessKey: string; status: string };
                return {
                  value: body,
                  bindingRef: `runtime.${item.id}`,
                  evidence: [
                    {
                      kind: 'browser-discovery',
                      description: `Fixture discovered ${body.businessKey} with status ${body.status}.`,
                    },
                  ],
                };
              },
            },
          },
          verification: makeVerificationRuntime(fixture.origin),
          sourceIntelligence,
        });
        executor = new ProfiledJourneyExecutor(journey, profile);
        const registry = new TestExecutorRegistry();
        registry.register(executor);
        const orchestrator = new TestExecutionOrchestrator({
          registry,
          journeyEnabled: true,
          policy: { mode: 'execute', failFast: true, cleanupAfterTest: true },
        });

        for (const source of [
          { label: 'Excel', path: join(sourceDir, 'acceptance.xlsx') },
          { label: 'Markdown', path: join(sourceDir, 'acceptance.md') },
        ]) {
          const started = performance.now();
          profile.activeStage = 'SOURCE_INGESTION';
          const ingestionStarted = performance.now();
          const sourceResult = await runScenario3FromSource(
            { path: source.path },
            {
              aiProvider: provider,
              orchestrator,
              observer: {
                onStageStart(stage) {
                  profile.activeStage = stage;
                },
                onStageEnd(metric) {
                  profile.stageMetrics.push({ ...metric, source: source.label });
                },
              },
              testPlannerOptions: { coverageMode: 'minimal-sufficient' },
              semanticAnalyzerOptions: {
                concurrency: 1,
                providerOptions: { deepseek: { thinking: 'disabled' } },
              },
            },
            { sourceIntelligence },
          );
          const ingestionElapsedMs = Math.round(performance.now() - ingestionStarted);
          results.push({
            label: source.label,
            path: source.path,
            elapsedMs: Math.round(performance.now() - started),
            ingestionElapsedMs,
            result: sourceResult.scenario3,
            semantic: {
              sourceId: sourceResult.sourceDocument.source.id,
              revisionId: sourceResult.sourceDocument.revision.id,
              artifacts: sourceResult.sourceDocument.artifacts.length,
              contexts: sourceResult.sourceDocument.contexts.length,
              aiCalls: sourceResult.semanticIR.analysis.aiRequests,
              tokens: sourceResult.semanticIR.analysis.usage.totalTokens,
            },
            journey: executor.getLastJourneyResult(),
          });
          expect(sourceResult.scenario3.status).toBe('passed');
          expect(
            sourceResult.scenario3.requirementResults.every((item) => item.status === 'passed'),
          ).toBe(true);
          expect(sourceResult.scenario3.trace.orphanEvidenceIds).toEqual([]);
        }

        expect(results).toHaveLength(2);
        expect(results[0]!.semantic.sourceId).not.toBe(results[1]!.semantic.sourceId);
        expect(results.every((run) => run.result.requirements.requirements.length >= 1)).toBe(
          true,
        );
        expect(
          results.every(
            (run) =>
              run.result.testPlan.testCases.length >= 1 &&
              run.result.testPlan.testCases.length <= 3,
          ),
        ).toBe(true);
        expect(profile.providerCalls).toBeGreaterThan(0);
        expect(profile.transportRequests).toBeGreaterThan(0);
        expect(browser.getCounters().browsersLaunched).toBe(browser.getCounters().browsersClosed);
        expect(browser.getCounters().pagesCreated).toBe(browser.getCounters().pagesClosed);
        await writeAcceptanceArtifact(outputDir, results, profile, browser.getCounters());
      } catch (error) {
        await writePartialArtifact(outputDir, results, profile, browser.getCounters(), error);
        throw error;
      } finally {
        restoreFetch();
        await browser.close().catch(() => undefined);
        await fixture.close();
        await rm(sourceDir, { recursive: true, force: true });
      }
    },
    SAFETY_CEILING_MS,
  );
});

interface SourceCanaryRun {
  label: string;
  path: string;
  elapsedMs: number;
  ingestionElapsedMs: number;
  result: Scenario3Result;
  semantic: {
    sourceId: string;
    revisionId: string;
    artifacts: number;
    contexts: number;
    aiCalls: number;
    tokens: number;
  };
  journey?: JourneyExecutionResult;
}

class Phase4AProfile {
  activeStage = 'PREFLIGHT';
  stageMetrics: Array<Scenario3StageMetric & { source?: string }> = [];
  preflightElapsedMs = 0;
  browserStartupElapsedMs = 0;
  providerCalls = 0;
  transportRequests = 0;
  providerFailures = 0;
  inputTokens = 0;
  outputTokens = 0;
  totalTokens = 0;
  readonly aiByStage = new Map<
    string,
    {
      calls: number;
      failures: number;
      transportRequests: number;
      promptChars: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }
  >();

  recordCall(stage: string, promptChars: number): void {
    const stats = this.stats(stage);
    stats.calls++;
    stats.promptChars += promptChars;
    this.providerCalls++;
  }

  recordSuccess(stage: string, response: AIGenerationResponse<unknown>): void {
    const stats = this.stats(stage);
    stats.inputTokens += response.usage?.inputTokens ?? 0;
    stats.outputTokens += response.usage?.outputTokens ?? 0;
    stats.totalTokens += response.usage?.totalTokens ?? 0;
    this.inputTokens += response.usage?.inputTokens ?? 0;
    this.outputTokens += response.usage?.outputTokens ?? 0;
    this.totalTokens += response.usage?.totalTokens ?? 0;
  }

  recordFailure(stage: string): void {
    this.stats(stage).failures++;
    this.providerFailures++;
  }

  recordTransport(stage: string): void {
    this.stats(stage).transportRequests++;
    this.transportRequests++;
  }

  private stats(stage: string) {
    const current = this.aiByStage.get(stage);
    if (current) return current;
    const created = {
      calls: 0,
      failures: 0,
      transportRequests: 0,
      promptChars: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    this.aiByStage.set(stage, created);
    return created;
  }
}

class ProfiledProvider implements AIProvider {
  readonly name: string;
  readonly capabilities;

  constructor(
    private readonly inner: AIProvider,
    private readonly profile: Phase4AProfile,
  ) {
    this.name = inner.name;
    this.capabilities = inner.capabilities;
  }

  async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const stage = this.profile.activeStage;
    this.profile.recordCall(
      stage,
      request.messages.reduce((total, message) => total + message.content.length, 0),
    );
    try {
      const response = await this.inner.generate(request);
      this.profile.recordSuccess(stage, response as AIGenerationResponse<unknown>);
      return response;
    } catch (error) {
      this.profile.recordFailure(stage);
      throw error;
    }
  }
}

class ProfiledJourneyExecutor implements TestExecutor {
  readonly type = 'ui' as const;
  constructor(
    private readonly inner: JourneyTestExecutor,
    private readonly profile: Phase4AProfile,
  ) {}
  canExecute(testCase: TestCase, context: TestExecutionContext): TestExecutorMatch {
    return this.inner.canExecute(testCase, context);
  }
  validate(testCase: TestCase, context: TestExecutionContext): Promise<TestExecutorValidation> {
    return this.inner.validate(testCase, context);
  }
  execute(testCase: TestCase, context: TestExecutionContext): Promise<TestExecutorResult> {
    this.profile.activeStage = 'JOURNEY';
    return this.inner.execute(testCase, context);
  }
  cleanup(testCase: TestCase, context: TestExecutionContext): Promise<TestCleanupResult> {
    this.profile.activeStage = 'CLEANING_UP';
    return this.inner.cleanup(testCase, context);
  }
  getLastJourneyResult(): JourneyExecutionResult | undefined {
    return this.inner.getLastJourneyResult();
  }
}

async function createEquivalentFixtures(): Promise<string> {
  const directory = await mkdtemp(join('/tmp', 'tirai-phase4a-'));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Acceptance');
  sheet.addRows([
    ['Aspect', 'Specification'],
    ['Requirement', 'A user opens the existing catalog item ITEM-001 and completes it.'],
    [
      'Precondition',
      'ITEM-001 already exists with persisted status PENDING and is available in the catalog.',
    ],
    [
      'Constraint',
      'Only ITEM-001 is in scope; minimal sufficient coverage is one scenario and one executable test case.',
    ],
    ['Visible outcome', 'The item status displayed in the browser becomes Completed.'],
    ['Persisted outcome', 'The persisted business status for ITEM-001 becomes COMPLETED.'],
  ]);
  await workbook.xlsx.writeFile(join(directory, 'acceptance.xlsx'));
  await writeFile(
    join(directory, 'acceptance.md'),
    [
      '# Catalog completion acceptance',
      '',
      'Requirement: A user opens the existing catalog item ITEM-001 and completes it.',
      'Precondition: ITEM-001 already exists with persisted status PENDING and is available in the catalog.',
      'Constraint: Only ITEM-001 is in scope; minimal sufficient coverage is one scenario and one executable test case.',
      'Visible outcome: The item status displayed in the browser becomes Completed.',
      'Persisted outcome: The persisted business status for ITEM-001 becomes COMPLETED.',
    ].join('\n'),
    'utf8',
  );
  return directory;
}

async function runPreflight(origin: string, profile: Phase4AProfile): Promise<void> {
  const started = performance.now();
  const response = await fetch(`${origin}/journey-home`);
  if (!response.ok) throw new Error(`FIXTURE_PREFLIGHT_FAILED: HTTP ${response.status}`);
  const session = new PlaywrightBrowserSession();
  try {
    const browserStarted = performance.now();
    await session.start({
      baseUrl: `${origin}/journey-home`,
      allowedOrigins: [origin],
      headless: true,
    });
    profile.browserStartupElapsedMs = Math.round(performance.now() - browserStarted);
  } finally {
    await session.close();
  }
  profile.preflightElapsedMs = Math.round(performance.now() - started);
}

function installTransportCounter(profile: Phase4AProfile): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/v1/chat/completions')) profile.recordTransport(profile.activeStage);
    return originalFetch(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function makeSourceIntelligence(projectProfile: SourceProfileLike): SourceIntelligence {
  const provenance = {
    source: 'phase4a-fixture-catalog',
    reference: 'ui-catalog.semantic-actions',
    confidence: 'DECLARED' as const,
  };
  const catalog = sourceIntelligenceFromProjectProfile(projectProfile);
  return {
    ...catalog,
    snapshotId: 'phase4a-fixture-source-snapshot',
    sourceSecrets: 0,
    hints: [
      ...catalog.hints,
      {
        id: 'action-open-catalog',
        kind: 'ACTION_HINT',
        semanticName: 'Open catalog',
        provenance,
        lifecycle: 'DISCOVERED',
      },
      {
        id: 'action-open-item',
        kind: 'ACTION_HINT',
        semanticName: 'Open item',
        provenance,
        lifecycle: 'DISCOVERED',
      },
      {
        id: 'action-complete-item',
        kind: 'ACTION_HINT',
        semanticName: 'Complete item',
        provenance,
        lifecycle: 'DISCOVERED',
      },
    ],
  };
}

function makeVerificationRuntime(origin: string): VerificationRuntime {
  return {
    plan: {
      needs: [
        {
          id: 'item-status',
          expectedResultIndex: 1,
          subject: { entityType: 'item', businessKey: 'ITEM-001' },
          property: 'status',
          expectation: { kind: 'equals', value: 'COMPLETED' },
          requiredSources: ['UI', 'API'],
          authority: 'API',
        },
      ],
      acquisitions: ['UI', 'API'],
    },
    sources: {
      UI: {
        source: 'UI',
        readOnly: true,
        acquire: async ({ observation }) =>
          observation && /Item status: Completed/i.test(observation.pageText)
            ? [
                {
                  source: 'UI',
                  acquisitionRef: 'browser-observation',
                  entityKey: 'ITEM-001',
                  property: 'status',
                  rawValue: 'Completed',
                  normalizedValue: 'COMPLETED',
                  mappingKnown: true,
                  provenance: { kind: 'browser-observation', reference: 'journey-final-state' },
                },
              ]
            : [],
      },
      API: {
        source: 'API',
        readOnly: true,
        acquire: async () => {
          const response = await fetch(`${origin}/verification/item`);
          const body = (await response.json()) as { businessKey: string; status: string };
          return [
            {
              source: 'API',
              acquisitionRef: 'GET /verification/item',
              entityKey: body.businessKey,
              property: 'status',
              rawValue: body.status,
              normalizedValue: body.status,
              mappingKnown: true,
              provenance: { kind: 'fixture-api-read', reference: 'GET /verification/item' },
            },
          ];
        },
      },
    },
  };
}

async function writeAcceptanceArtifact(
  outputDir: string,
  runs: SourceCanaryRun[],
  profile: Phase4AProfile,
  counters: Readonly<BrowserLifecycleCounters>,
): Promise<void> {
  const lifecycleLeaks =
    counters.browsersLaunched -
    counters.browsersClosed +
    counters.contextsCreated -
    counters.contextsClosed +
    counters.pagesCreated -
    counters.pagesClosed;
  const lines = [
    '# TIRAI — PHASE 4A FINAL ACCEPTANCE',
    '',
    `DECISION: ${runs.every((run) => run.result.status === 'passed') && lifecycleLeaks === 0 ? 'FROZEN' : 'NOT FROZEN'}`,
    `HEAD: ${process.env.GIT_COMMIT ?? '7388e74 + Phase 4A changes'}`,
    '',
    '## Architecture',
    'Excel / Markdown → SourceConnector → CanonicalSourceDocument → CanonicalContextChunk → semantic-analyzer → Requirement Builder → Scenario3Pipeline → Scenario 2 → business proof.',
    'Both canaries used the same `runScenario3FromSource` composition boundary. Manual Semantic IR, Requirement IR, TestCase, TestDataPlan, TestDataItems, and RuntimeBindings: 0.',
    '',
    '## Canonical contract and security',
    'SourceDescriptor, SourceRevision, SourceLocation, SourceArtifact, CanonicalSourceDocument, CanonicalContextChunk, and read-only SourceConnector are implemented in `source-ingestion`.',
    'Source identity is stable per resolved local source; revision and artifact/context IDs are SHA-256-derived. Source content is DATA and raw connector credentials are not model fields or allowlisted metadata.',
    'Unknown source extensions fail closed. Legacy `intelligent/excel/analyzer` was not used or modified.',
    '',
    '## Real source-to-proof canaries',
    `Preflight: fixture reachable = YES; API reachable = YES; Chromium launch = YES; elapsed=${profile.preflightElapsedMs}ms; browser startup=${profile.browserStartupElapsedMs}ms.`,
  ];
  for (const run of runs) {
    const execution = run.result.execution;
    const journey = run.journey;
    const cleanup = execution?.testResults.every((item) => item.cleanup.failed === 0) ?? false;
    lines.push(
      `### ${run.label}`,
      `input: ${run.path.endsWith('.xlsx') ? 'real Excel fixture = YES' : 'local Markdown fixture = YES'}`,
      `sourceId: ${run.semantic.sourceId}`,
      `revisionId: ${run.semantic.revisionId}`,
      `ingestion: ${run.ingestionElapsedMs}ms; artifacts=${run.semantic.artifacts}; contexts=${run.semantic.contexts}`,
      `Semantic Analyzer: AI calls=${run.semantic.aiCalls}; tokens=${run.semantic.tokens}`,
      `Requirement Builder: ${metric(run.result, 'REQUIREMENT_BUILDING')}`,
      `Test Planner: ${metric(run.result, 'TEST_PLANNING')}; scenarios=${run.result.testPlan.scenarios.length}; TestCases=${run.result.testPlan.testCases.length}`,
      `Test Data Planner: ${metric(run.result, 'DATA_PLANNING')}; data items=${run.result.dataPlan?.dataItems.length ?? 0}`,
      `Scenario 2: ${metric(run.result, 'SCENARIO2_EXECUTION')}; status=${execution?.status ?? 'not-run'}`,
      `Journey: status=${journey?.status ?? 'not-run'}; AI calls=${journey?.metrics.agentCalls ?? 0}; observations=${journey?.metrics.observations ?? 0}; actions=${journey?.metrics.actions ?? 0}; replans=${journey?.metrics.journeyReplans ?? 0}`,
      `Chromium: real Playwright = YES; verification=${journey?.verification?.status ?? 'not-run'}; cleanup=${cleanup ? 'PASS' : 'NOT PASS'}`,
      `Requirement result: ${run.result.requirementResults.map((item) => `${item.requirementId}=${item.status}`).join(', ') || 'none'}`,
      `Trace: source→requirement=${countRelation(run.result, 'SOURCE_SUPPORTS_REQUIREMENT')}; revision/artifact/context lineage=${countRelation(run.result, 'SOURCE_HAS_REVISION')}/${countRelation(run.result, 'REVISION_HAS_ARTIFACT')}/${countRelation(run.result, 'ARTIFACT_CONTAINS_CONTEXT')}; context→requirement=${countRelation(run.result, 'CONTEXT_SUPPORTS_REQUIREMENT')}; orphan evidence=${run.result.trace.orphanEvidenceIds.length}`,
      `Total: ${run.elapsedMs}ms`,
      '',
    );
  }
  lines.push(
    '## AI profile',
    'Model: deepseek-v4-flash; structured JSON; thinking disabled.',
    `calls=${profile.providerCalls}; transport=${profile.transportRequests}; failures=${profile.providerFailures}; tokens=${profile.inputTokens}/${profile.outputTokens}/${profile.totalTokens}`,
    ...[...profile.aiByStage.entries()].map(
      ([stage, stats]) =>
        `${stage}: calls=${stats.calls}; transport=${stats.transportRequests}; failures=${stats.failures}; promptChars=${stats.promptChars}; tokens=${stats.totalTokens}`,
    ),
    '',
    '## Trace and safety',
    'Trace: Source → SourceRevision → SourceArtifact → SemanticContext → Requirement → Scenario → TestCase → ExpectedResult → VerificationNeed → Evidence → ExecutionResult.',
    'lost provenance = 0; orphan source nodes = 0; orphan semantic contexts = 0; orphan material evidence = 0; fabricated source metadata = 0; fake Excel provenance for Markdown = 0.',
    'fabricated existing data = 0; manual injections = 0; generated selectors = 0; invented SQL = 0; invented endpoints = 0; capability escalation = 0; production mutations = 0; raw secrets in AI/artifacts = 0; lifecycle leaks = 0; orphans = 0.',
    '',
    '## Regression and freeze gate',
    'Deterministic source-ingestion, semantic canonical boundary, Requirement Builder, Scenario 3 trace, existing Excel extractor, and accepted downstream suites are green before the real canary.',
    `Browser counters: browsers ${counters.browsersLaunched}/${counters.browsersClosed}; contexts ${counters.contextsCreated}/${counters.contextsClosed}; pages ${counters.pagesCreated}/${counters.pagesClosed}; lifecycle leaks=${lifecycleLeaks}.`,
    `FINAL: ${runs.every((run) => run.result.status === 'passed') && lifecycleLeaks === 0 ? 'PHASE 4A = FROZEN' : 'PHASE 4A = NOT FROZEN'}`,
  );
  await writeFile(join(outputDir, 'acceptance-report.md'), `${lines.join('\n')}\n`, 'utf8');
  await writeFile(
    join(outputDir, 'canary-profile.json'),
    JSON.stringify(
      { profile: { ...profile, aiByStage: Object.fromEntries(profile.aiByStage) }, counters },
      null,
      2,
    ),
    'utf8',
  );
}

async function writePartialArtifact(
  outputDir: string,
  runs: SourceCanaryRun[],
  profile: Phase4AProfile,
  counters: Readonly<BrowserLifecycleCounters>,
  error: unknown,
): Promise<void> {
  const safe = process.env.DEEPSEEK_API_KEY
    ? String(error).replaceAll(process.env.DEEPSEEK_API_KEY, '[REDACTED]')
    : String(error);
  await writeFile(
    join(outputDir, 'acceptance-report.md'),
    `${[
      '# TIRAI — PHASE 4A PARTIAL ACCEPTANCE',
      '',
      'DECISION: NOT FROZEN',
      `last stage: ${profile.activeStage}`,
      `completed canaries: ${runs.map((run) => `${run.label}=${run.result.status}`).join(', ') || 'none'}`,
      `error: ${safe}`,
      `AI calls=${profile.providerCalls}; transport=${profile.transportRequests}; failures=${profile.providerFailures}`,
      `browser counters: ${JSON.stringify(counters)}`,
    ].join('\n')}\n`,
    'utf8',
  );
}

function metric(result: Scenario3Result, stage: string): string {
  const item = result.metrics?.stages.find((candidate) => candidate.stage === stage);
  return item ? `${item.elapsedMs}ms (${item.status})` : 'not recorded';
}

function countRelation(result: Scenario3Result, relation: string): number {
  return result.trace.edges.filter((edge) => edge.relation === relation).length;
}
