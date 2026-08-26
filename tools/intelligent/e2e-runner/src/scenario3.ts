import type { AIProvider } from 'ai-provider';
import { buildRequirementsFromSemanticIR, type RequirementIR, type SemanticIRInput } from 'requirement-builder';
import { buildTestPlanFromRequirementIR, type TestPlanIR, type TestPlannerOptions, type TestPlannerWarning } from 'test-planner';
import { buildTestDataPlanFromTestCaseIR, type TestCaseIRInput, type TestDataPlanIR } from 'test-data-planner';
import { TestExecutionOrchestrator, type OrchestratorOptions, type TestRunResultIR } from 'test-execution-orchestrator';

export interface Scenario3Input {
  semanticIR: SemanticIRInput;
  sourceIntelligence?: unknown;
  runtimeContext?: unknown;
  capabilities?: unknown;
  policy?: unknown;
  onProgress?: (event: Scenario3ProgressEvent) => void;
}

export type Scenario3Stage = 'REQUIREMENT_BUILDING' | 'TEST_PLANNING' | 'DATA_PLANNING' | 'EXECUTING';

export interface Scenario3ProgressEvent {
  stage: Scenario3Stage;
  phase: 'started' | 'completed' | 'failed';
  elapsedMs?: number;
  error?: string;
}

/** @deprecated Use Scenario3Input. */
export interface Scenario3Specification<TSpecification = unknown> {
  specification: TSpecification;
  sourceIntelligence?: unknown;
}

export interface Scenario3Dependencies {
  aiProvider: AIProvider;
  /** Runtime executor infrastructure. The pipeline creates the orchestrator. */
  orchestratorOptions?: OrchestratorOptions;
  /** Test-only replacement for the canonical orchestrator. */
  orchestrator?: TestExecutionOrchestrator;
  /** Optional structured stage observer for bounded runtime diagnostics. */
  observer?: Scenario3StageObserver;
  /** Optional planner policy; production defaults remain comprehensive. */
  testPlannerOptions?: TestPlannerOptions;
}

export type Scenario3StageName =
  | 'REQUIREMENT_BUILDING'
  | 'TEST_PLANNING'
  | 'DATA_PLANNING'
  | 'SCENARIO2_EXECUTION';

export interface Scenario3StageMetric {
  stage: Scenario3StageName;
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  error?: string;
}

export interface Scenario3RunMetrics {
  startedAt: string;
  finishedAt: string;
  totalElapsedMs: number;
  stages: Scenario3StageMetric[];
}

export interface Scenario3StageObserver {
  onStageStart?(stage: Scenario3StageName, startedAt: string): void;
  onStageEnd?(metric: Scenario3StageMetric): void;
}

/** @deprecated Test-only compatibility seam. Product callers use Scenario3Dependencies. */
export interface Scenario3StageAdapters<TSpecification = unknown, TRequirementIR = unknown> {
  buildRequirements(input: { specification: TSpecification; sourceIntelligence?: unknown }): Promise<TRequirementIR>;
  buildTestPlan(requirements: TRequirementIR, sourceIntelligence?: unknown): Promise<TestPlanIR>;
  buildTestDataPlan(testPlan: TestPlanIR): Promise<TestDataPlanIR>;
}

/** @deprecated Test-only compatibility seam. Product callers use the canonical orchestrator. */
export interface Scenario3ExecutionAdapter<TResult = unknown> {
  execute(testCases: TestPlanIR['testCases'], dataPlan: TestDataPlanIR): Promise<TResult>;
}

export interface Scenario3TraceNode {
  id: string;
  kind: 'source' | 'source-revision' | 'source-artifact' | 'semantic-context' | 'requirement' | 'scenario' | 'test-case' | 'data-need' | 'data-item' | 'expected-result' | 'verification-need' | 'evidence' | 'execution-result';
  ref: string;
  metadata?: Record<string, unknown>;
  /** Content-addressable fingerprint of the source revision at time of trace node creation. */
  revisionFingerprint?: string;
}

export type Scenario3TraceRelation =
  | 'SOURCE_HAS_REVISION' | 'REVISION_HAS_ARTIFACT' | 'ARTIFACT_CONTAINS_CONTEXT' | 'CONTEXT_SUPPORTS_REQUIREMENT'
  | 'SOURCE_SUPPORTS_REQUIREMENT' | 'REQUIREMENT_COVERED_BY_SCENARIO'
  | 'SCENARIO_IMPLEMENTED_BY_TESTCASE' | 'TESTCASE_REQUIRES_DATA'
  | 'TESTCASE_EXPECTS_RESULT' | 'EXPECTED_RESULT_VERIFIED_BY_NEED'
  | 'VERIFICATION_NEED_SUPPORTED_BY_EVIDENCE' | 'EVIDENCE_CONTRIBUTES_TO_EXECUTION_RESULT';

export interface Scenario3TraceGraph {
  nodes: Scenario3TraceNode[];
  edges: Scenario3TraceEdge[];
  orphanEvidenceIds: string[];
}

export interface Scenario3TraceEdge {
  from: string;
  to: string;
  relation: Scenario3TraceRelation;
}

export interface Scenario3RequirementResult {
  requirementId: string;
  status: 'passed' | 'failed' | 'blocked' | 'error';
  testCaseIds: string[];
  evidenceIds: string[];
  traceNodeId: string;
}

export interface Scenario3Result {
  status: 'passed' | 'blocked' | 'failed' | 'error';
  requirements: RequirementIR;
  testPlan: TestPlanIR;
  dataPlan?: TestDataPlanIR;
  execution?: TestRunResultIR;
  requirementResults: Scenario3RequirementResult[];
  trace: Scenario3TraceGraph;
  warnings: TestPlannerWarning[];
  metrics?: Scenario3RunMetrics;
  /** Content-addressable fingerprint of the source revision for cross-revision tracking. */
  revisionFingerprint?: string;
}

/** Native specification-to-Scenario-2 owner. */
export class Scenario3Pipeline {
  private readonly orchestrator: TestExecutionOrchestrator | undefined;

  constructor(private readonly dependencies: Scenario3Dependencies | Scenario3StageAdapters) {
    if ('aiProvider' in dependencies) {
      this.orchestrator = dependencies.orchestrator ?? (dependencies.orchestratorOptions ? new TestExecutionOrchestrator(dependencies.orchestratorOptions) : undefined);
    }
  }

  async run(input: Scenario3Input | { specification: unknown; sourceIntelligence?: unknown }, legacyExecution?: Scenario3ExecutionAdapter): Promise<Scenario3Result> {
    if ('buildRequirements' in this.dependencies && legacyExecution) {
      return this.runLegacy(input as { specification: unknown; sourceIntelligence?: unknown }, this.dependencies, legacyExecution);
    }
    if (!('aiProvider' in this.dependencies) || !this.orchestrator) {
      throw new Error('Scenario3Pipeline requires canonical platform dependencies');
    }
    const canonicalDependencies = this.dependencies as Scenario3Dependencies;
    const canonicalInput = input as Scenario3Input;
    const observer = canonicalDependencies.observer;
    const startedAt = new Date().toISOString();
    const startedTick = performance.now();
    const stageMetrics: Scenario3StageMetric[] = [];
    const finalize = (result: Scenario3Result): Scenario3Result => ({
      ...result,
      metrics: {
        startedAt,
        finishedAt: new Date().toISOString(),
        totalElapsedMs: Math.round(performance.now() - startedTick),
        stages: [...stageMetrics],
      },
    });
    const runStage = async <T>(stage: Scenario3StageName, action: () => Promise<T>): Promise<T> => {
      const stageStartedAt = new Date().toISOString();
      const stageStartedTick = performance.now();
      const progressStage: Scenario3Stage = stage === 'SCENARIO2_EXECUTION' ? 'EXECUTING' : stage;
      observer?.onStageStart?.(stage, stageStartedAt);
      canonicalInput.onProgress?.({ stage: progressStage, phase: 'started' });
      try {
        const result = await action();
        const metric: Scenario3StageMetric = {
          stage,
          status: 'completed',
          startedAt: stageStartedAt,
          finishedAt: new Date().toISOString(),
          elapsedMs: Math.round(performance.now() - stageStartedTick),
        };
        stageMetrics.push(metric);
        observer?.onStageEnd?.(metric);
        canonicalInput.onProgress?.({ stage: progressStage, phase: 'completed', elapsedMs: metric.elapsedMs });
        return result;
      } catch (error) {
        const metric: Scenario3StageMetric = {
          stage,
          status: 'failed',
          startedAt: stageStartedAt,
          finishedAt: new Date().toISOString(),
          elapsedMs: Math.round(performance.now() - stageStartedTick),
          error: error instanceof Error ? error.message : String(error),
        };
        stageMetrics.push(metric);
        observer?.onStageEnd?.(metric);
        canonicalInput.onProgress?.({ stage: progressStage, phase: 'failed', elapsedMs: metric.elapsedMs, error: metric.error });
        throw error;
      }
    };
    let requirements: RequirementIR | undefined;
    let testPlan: TestPlanIR | undefined;
    const warnings: TestPlannerWarning[] = [];
    try {
      const builtRequirements = await runStage(
        'REQUIREMENT_BUILDING',
        () => buildRequirementsFromSemanticIR(canonicalInput.semanticIR, canonicalDependencies.aiProvider),
      );
      requirements = builtRequirements;
      testPlan = await runStage(
        'TEST_PLANNING',
        () => buildTestPlanFromRequirementIR(builtRequirements, canonicalDependencies.aiProvider, canonicalDependencies.testPlannerOptions),
      );
      warnings.push(...(testPlan.warnings ?? []));
    } catch (error) {
      return finalize(this.errorResult(error, warnings, requirements, testPlan, canonicalInput.semanticIR?.revisionFingerprint));
    }
    if (!requirements || !testPlan) {
      return finalize(this.errorResult(new Error('SCENARIO3_PLANNING_OUTPUT_MISSING'), warnings, requirements, testPlan));
    }
    if (hasPlanningBlocker(warnings) || testPlan.testCases.length === 0) {
      return finalize(this.withoutExecution(requirements, testPlan, warnings, 'blocked'));
    }

    let dataPlan: TestDataPlanIR;
    try {
      dataPlan = await runStage(
        'DATA_PLANNING',
        () => buildTestDataPlanFromTestCaseIR(toTestCaseIRInput(testPlan), canonicalDependencies.aiProvider),
      );
    } catch (error) {
      return finalize(this.withoutExecution(requirements, testPlan, [...warnings, { code: 'SCENARIO3_DATA_PLAN_ERROR', message: String(error) }], 'error'));
    }

    try {
      const execution = await runStage(
        'SCENARIO2_EXECUTION',
        () => this.orchestrator!.run(testPlan.testCases, dataPlan),
      );
      const revisionFingerprint = canonicalInput.semanticIR?.revisionFingerprint;
      const trace = buildTrace(requirements, testPlan, dataPlan, execution, revisionFingerprint);
      return finalize({
        status: statusFromExecution(execution), requirements, testPlan, dataPlan, execution,
        requirementResults: aggregateRequirements(testPlan, execution), trace, warnings,
        revisionFingerprint,
      });
    } catch (error) {
      return finalize(this.withoutExecution(requirements, testPlan, [...warnings, { code: 'SCENARIO3_EXECUTION_ERROR', message: String(error) }], 'error', dataPlan));
    }
  }

  private async runLegacy(input: { specification: unknown; sourceIntelligence?: unknown }, stages: Scenario3StageAdapters, execution: Scenario3ExecutionAdapter): Promise<Scenario3Result> {
    const requirements = await stages.buildRequirements(input);
    const testPlan = await stages.buildTestPlan(requirements, input.sourceIntelligence);
    const warnings = testPlan.warnings ?? [];
    if (hasPlanningBlocker(warnings)) return { requirements: requirements as RequirementIR, testPlan, status: 'blocked', warnings, requirementResults: [], trace: emptyTrace(), };
    const dataPlan = await stages.buildTestDataPlan(testPlan);
    const result = await execution.execute(testPlan.testCases, dataPlan);
    return { requirements: requirements as RequirementIR, testPlan, dataPlan, execution: undefined, status: resultStatus(result), requirementResults: [], trace: emptyTrace(), warnings };
  }

  private errorResult(
    error: unknown,
    warnings: TestPlannerWarning[],
    requirements?: RequirementIR,
    testPlan?: TestPlanIR,
    revisionFingerprint?: string,
  ): Scenario3Result {
    const trace = requirements
      ? testPlan
        ? buildTrace(requirements, testPlan, undefined, undefined, revisionFingerprint)
        : buildRequirementTrace(requirements, revisionFingerprint)
      : emptyTrace();
    return {
      status: 'error',
      requirements: requirements as RequirementIR,
      testPlan: testPlan as TestPlanIR,
      requirementResults: requirements?.requirements.map((requirement) => ({
        requirementId: requirement.id,
        status: 'error' as const,
        testCaseIds: [],
        evidenceIds: [],
        traceNodeId: `requirement:${requirement.id}`,
      })) ?? [],
      trace,
      warnings: [...warnings, { code: 'SCENARIO3_PLANNING_ERROR', message: String(error) }],
      revisionFingerprint,
    };
  }

  private withoutExecution(requirements: RequirementIR, testPlan: TestPlanIR, warnings: TestPlannerWarning[], status: Scenario3Result['status'], dataPlan?: TestDataPlanIR, revisionFingerprint?: string): Scenario3Result {
    const trace = buildTrace(requirements, testPlan, dataPlan, undefined, revisionFingerprint);
    return {
      status, requirements, testPlan, dataPlan,
      requirementResults: testPlan.scope.requirementIds.map((requirementId) => ({ requirementId, status, testCaseIds: [], evidenceIds: [], traceNodeId: `requirement:${requirementId}` })),
      trace, warnings,
      revisionFingerprint,
    };
  }
}

function resultStatus(result: unknown): Scenario3Result['status'] {
  if (typeof result === 'object' && result !== null && 'status' in result) {
    const status = (result as { status?: unknown }).status;
    if (status === 'blocked' || status === 'failed' || status === 'error') return status;
  }
  return 'passed';
}

function emptyTrace(): Scenario3TraceGraph {
  return { nodes: [], edges: [], orphanEvidenceIds: [] };
}

function addProvenanceLineage(
  nodes: Scenario3TraceNode[],
  edges: Scenario3TraceEdge[],
  provenance: RequirementIR['requirements'][number]['provenance'][number],
  requirementId: string,
  revisionFingerprint?: string,
): void {
  const sourceIdentity = provenance.sourceId ?? provenance.contextId;
  const sourceNodeId = `source:${sourceIdentity}`;
  if (!nodes.some((node) => node.id === sourceNodeId)) {
    nodes.push({ id: sourceNodeId, kind: 'source', ref: sourceIdentity, metadata: { ...provenance }, revisionFingerprint });
  }
  if (provenance.revisionId && provenance.artifactId && provenance.location) {
    const revisionNodeId = `source-revision:${sourceIdentity}:${provenance.revisionId}`;
    const artifactNodeId = `source-artifact:${provenance.artifactId}`;
    const contextNodeId = `semantic-context:${provenance.contextId}`;
    if (!nodes.some((node) => node.id === revisionNodeId)) {
      nodes.push({ id: revisionNodeId, kind: 'source-revision', ref: provenance.revisionId, metadata: { sourceId: sourceIdentity }, revisionFingerprint });
      edges.push({ from: sourceNodeId, to: revisionNodeId, relation: 'SOURCE_HAS_REVISION' });
    }
    if (!nodes.some((node) => node.id === artifactNodeId)) {
      nodes.push({ id: artifactNodeId, kind: 'source-artifact', ref: provenance.artifactId, metadata: { sourceId: sourceIdentity, revisionId: provenance.revisionId, location: provenance.location }, revisionFingerprint });
      edges.push({ from: revisionNodeId, to: artifactNodeId, relation: 'REVISION_HAS_ARTIFACT' });
    }
    if (!nodes.some((node) => node.id === contextNodeId)) {
      nodes.push({ id: contextNodeId, kind: 'semantic-context', ref: provenance.contextId, metadata: { artifactId: provenance.artifactId, location: provenance.location }, revisionFingerprint });
      edges.push({ from: artifactNodeId, to: contextNodeId, relation: 'ARTIFACT_CONTAINS_CONTEXT' });
    }
    edges.push({ from: contextNodeId, to: requirementId, relation: 'CONTEXT_SUPPORTS_REQUIREMENT' });
  }
  edges.push({ from: sourceNodeId, to: requirementId, relation: 'SOURCE_SUPPORTS_REQUIREMENT' });
}

function buildRequirementTrace(requirements: RequirementIR, revisionFingerprint?: string): Scenario3TraceGraph {
  const nodes: Scenario3TraceNode[] = [];
  const edges: Scenario3TraceEdge[] = [];
  for (const requirement of requirements.requirements) {
    const requirementId = `requirement:${requirement.id}`;
    nodes.push({ id: requirementId, kind: 'requirement', ref: requirement.id, metadata: { title: requirement.title }, revisionFingerprint });
    for (const provenance of requirement.provenance) {
      addProvenanceLineage(nodes, edges, provenance, requirementId, revisionFingerprint);
    }
  }
  return { nodes, edges, orphanEvidenceIds: [] };
}

export async function runScenario3(input: Scenario3Input, dependencies: Scenario3Dependencies): Promise<Scenario3Result> {
  return new Scenario3Pipeline(dependencies).run(input);
}

function toTestCaseIRInput(testPlan: TestPlanIR): TestCaseIRInput {
  return {
    schemaVersion: testPlan.schemaVersion,
    testCases: testPlan.testCases.map((tc) => ({
      ...tc,
      expectedResults: tc.expectedResults.map(({ description, verificationType, target }) => ({ description, verificationType, target })),
    })),
    dataNeeds: testPlan.dataNeeds,
  };
}

function hasPlanningBlocker(warnings: TestPlannerWarning[]): boolean {
  return warnings.some((warning) => ['TEST_CASE_NON_EXECUTABLE', 'TEST_CASE_INVALID_STEP_ORDER', 'TEST_CASE_UNSUPPORTED_AUTOMATION', 'TEST_EXPECTATION_UNSPECIFIED', 'TEST_EXPECTATION_UNTRACEABLE', 'TEST_REQUIREMENT_NOT_COVERED'].includes(warning.code));
}

function statusFromExecution(execution: TestRunResultIR): Scenario3Result['status'] {
  if (execution.status === 'error') return 'error';
  if (execution.status === 'failed') return 'failed';
  if (execution.status === 'partial') return execution.summary.failed > 0 ? 'failed' : 'blocked';
  return 'passed';
}

export function buildTrace(requirements: RequirementIR, testPlan: TestPlanIR, dataPlan?: TestDataPlanIR, execution?: TestRunResultIR, revisionFingerprint?: string): Scenario3TraceGraph {
  const nodes: Scenario3TraceNode[] = [];
  const edges: Scenario3TraceGraph['edges'] = [];
  const add = (node: Scenario3TraceNode) => { if (!nodes.some((n) => n.id === node.id)) nodes.push(node); };
  const link = (from: string, to: string, relation: Scenario3TraceRelation) => edges.push({ from, to, relation });
  for (const req of requirements.requirements) {
    const reqId = `requirement:${req.id}`;
    add({ id: reqId, kind: 'requirement', ref: req.id, metadata: { title: req.title }, revisionFingerprint });
    for (const provenance of req.provenance) {
      addProvenanceLineage(nodes, edges, provenance, req.id, revisionFingerprint);
    }
  }
  for (const scenario of testPlan.scenarios) {
    const id = `scenario:${scenario.id}`;
    add({ id, kind: 'scenario', ref: scenario.id, revisionFingerprint });
    for (const reqId of scenario.requirementIds) link(`requirement:${reqId}`, id, 'REQUIREMENT_COVERED_BY_SCENARIO');
  }
  for (const tc of testPlan.testCases) {
    const tcId = `test-case:${tc.id}`;
    add({ id: tcId, kind: 'test-case', ref: tc.id, revisionFingerprint });
    link(`scenario:${tc.scenarioId}`, tcId, 'SCENARIO_IMPLEMENTED_BY_TESTCASE');
    for (let i = 0; i < tc.expectedResults.length; i++) {
      const erId = `expected:${tc.id}:${i}`;
      const vnId = `verification:${tc.id}:${i}`;
      add({ id: erId, kind: 'expected-result', ref: erId, metadata: tc.expectedResults[i]!.verificationIntent ? { ...tc.expectedResults[i]!.verificationIntent } : undefined, revisionFingerprint });
      add({ id: vnId, kind: 'verification-need', ref: vnId, metadata: tc.expectedResults[i]!.verificationIntent ? { ...tc.expectedResults[i]!.verificationIntent } : undefined, revisionFingerprint });
      link(tcId, erId, 'TESTCASE_EXPECTS_RESULT');
      link(erId, vnId, 'EXPECTED_RESULT_VERIFIED_BY_NEED');
    }
    for (const need of tc.dataNeeds) {
      const needId = `data-need:${need.id}`;
      add({ id: needId, kind: 'data-need', ref: need.id, metadata: { description: need.description }, revisionFingerprint });
      link(tcId, needId, 'TESTCASE_REQUIRES_DATA');
    }
  }
  for (const item of dataPlan?.dataItems ?? []) {
    const id = `data-item:${item.id}`;
    add({ id, kind: 'data-item', ref: item.id, metadata: { lifecycle: item.lifecycle }, revisionFingerprint });
    for (const tcId of item.relatedTestCaseIds) link(`test-case:${tcId}`, id, 'TESTCASE_REQUIRES_DATA');
  }
  const evidenceIds = new Set<string>();
  const linkedEvidence = new Set<string>();
  for (const result of execution?.testResults ?? []) {
    const resultId = `execution:${result.testCaseId}`;
    add({ id: resultId, kind: 'execution-result', ref: result.testCaseId, metadata: { status: result.status } });
    for (const evidence of result.evidence) {
      const evidenceId = `evidence:${evidence.id}`;
      evidenceIds.add(evidenceId);
      add({ id: evidenceId, kind: 'evidence', ref: evidence.id, metadata: { type: evidence.type } });
      link(evidenceId, resultId, 'EVIDENCE_CONTRIBUTES_TO_EXECUTION_RESULT');
      const evidenceAssertionId = evidence.assertionId;
      const explicitExpectedResultIndex = typeof evidence.metadata.expectedResultIndex === 'number'
        ? evidence.metadata.expectedResultIndex
        : undefined;
      const assertion = explicitExpectedResultIndex !== undefined
        ? result.assertions.find((a) => a.expectedResultIndex === explicitExpectedResultIndex)
        : evidenceAssertionId
        ? result.assertions.find((a) => a.id === evidenceAssertionId) ??
          result.assertions.find((a) => a.expectedResultIndex === assertionIndexFromEvidenceId(evidenceAssertionId))
        : undefined;
      const verificationNeedIndex = explicitExpectedResultIndex ?? assertion?.expectedResultIndex;
      if (verificationNeedIndex !== undefined) {
        const vnId = `verification:${result.testCaseId}:${verificationNeedIndex}`;
        link(vnId, evidenceId, 'VERIFICATION_NEED_SUPPORTED_BY_EVIDENCE');
        linkedEvidence.add(evidenceId);
      }
    }
  }
  return { nodes, edges, orphanEvidenceIds: [...evidenceIds].filter((id) => !linkedEvidence.has(id)) };
}

function assertionIndexFromEvidenceId(assertionId: string): number | undefined {
  const match = /^ASSERT-(\d+)$/.exec(assertionId);
  if (!match) return undefined;
  const oneBasedIndex = Number(match[1]);
  return Number.isInteger(oneBasedIndex) && oneBasedIndex > 0 ? oneBasedIndex - 1 : undefined;
}

function aggregateRequirements(testPlan: TestPlanIR, execution: TestRunResultIR): Scenario3RequirementResult[] {
  return testPlan.scope.requirementIds.map((requirementId) => {
    const results = execution.testResults.filter((result) => result.requirementIds.includes(requirementId));
    const status: Scenario3RequirementResult['status'] = results.some((r) => r.status === 'error') ? 'error' : results.some((r) => r.status === 'failed') ? 'failed' : results.some((r) => r.status === 'blocked' || r.status === 'skipped') ? 'blocked' : 'passed';
    return { requirementId, status, testCaseIds: results.map((r) => r.testCaseId), evidenceIds: results.flatMap((r) => r.evidence.map((e) => e.id)), traceNodeId: `requirement:${requirementId}` };
  });
}
