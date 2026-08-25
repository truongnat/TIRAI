import type { AIProvider } from 'ai-provider';
import { buildRequirementsFromSemanticIR, type RequirementIR, type SemanticIRInput } from 'requirement-builder';
import { buildTestPlanFromRequirementIR, type TestPlanIR, type TestPlannerWarning } from 'test-planner';
import { buildTestDataPlanFromTestCaseIR, type TestCaseIRInput, type TestDataPlanIR } from 'test-data-planner';
import { TestExecutionOrchestrator, type OrchestratorOptions, type TestRunResultIR } from 'test-execution-orchestrator';

export interface Scenario3Input {
  semanticIR: SemanticIRInput;
  sourceIntelligence?: unknown;
  runtimeContext?: unknown;
  capabilities?: unknown;
  policy?: unknown;
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
  kind: 'source' | 'requirement' | 'scenario' | 'test-case' | 'data-need' | 'data-item' | 'expected-result' | 'verification-need' | 'evidence' | 'execution-result';
  ref: string;
  metadata?: Record<string, unknown>;
}

export type Scenario3TraceRelation =
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
    const canonicalInput = input as Scenario3Input;
    let requirements: RequirementIR;
    let testPlan: TestPlanIR;
    const warnings: TestPlannerWarning[] = [];
    try {
      requirements = await buildRequirementsFromSemanticIR(canonicalInput.semanticIR, this.dependencies.aiProvider);
      testPlan = await buildTestPlanFromRequirementIR(requirements, this.dependencies.aiProvider);
      warnings.push(...(testPlan.warnings ?? []));
    } catch (error) {
      return this.errorResult(error, warnings);
    }
    if (hasPlanningBlocker(warnings) || testPlan.testCases.length === 0) {
      return this.withoutExecution(requirements, testPlan, warnings, 'blocked');
    }

    let dataPlan: TestDataPlanIR;
    try {
      dataPlan = await buildTestDataPlanFromTestCaseIR(toTestCaseIRInput(testPlan), this.dependencies.aiProvider);
    } catch (error) {
      return this.withoutExecution(requirements, testPlan, [...warnings, { code: 'SCENARIO3_DATA_PLAN_ERROR', message: String(error) }], 'error');
    }

    try {
      const execution = await this.orchestrator.run(testPlan.testCases, dataPlan);
      const trace = buildTrace(requirements, testPlan, dataPlan, execution);
      return {
        status: statusFromExecution(execution), requirements, testPlan, dataPlan, execution,
        requirementResults: aggregateRequirements(testPlan, execution), trace, warnings,
      };
    } catch (error) {
      return this.withoutExecution(requirements, testPlan, [...warnings, { code: 'SCENARIO3_EXECUTION_ERROR', message: String(error) }], 'error', dataPlan);
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

  private errorResult(error: unknown, warnings: TestPlannerWarning[]): Scenario3Result {
    return {
      status: 'error', requirements: undefined as unknown as RequirementIR, testPlan: undefined as unknown as TestPlanIR,
      requirementResults: [], trace: { nodes: [], edges: [], orphanEvidenceIds: [] },
      warnings: [...warnings, { code: 'SCENARIO3_PLANNING_ERROR', message: String(error) }],
    };
  }

  private withoutExecution(requirements: RequirementIR, testPlan: TestPlanIR, warnings: TestPlannerWarning[], status: Scenario3Result['status'], dataPlan?: TestDataPlanIR): Scenario3Result {
    const trace = buildTrace(requirements, testPlan, dataPlan);
    return {
      status, requirements, testPlan, dataPlan,
      requirementResults: testPlan.scope.requirementIds.map((requirementId) => ({ requirementId, status, testCaseIds: [], evidenceIds: [], traceNodeId: `requirement:${requirementId}` })),
      trace, warnings,
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
  return warnings.some((warning) => ['TEST_CASE_NON_EXECUTABLE', 'TEST_CASE_INVALID_STEP_ORDER', 'TEST_CASE_UNSUPPORTED_AUTOMATION', 'TEST_EXPECTATION_UNTRACEABLE', 'TEST_REQUIREMENT_NOT_COVERED'].includes(warning.code));
}

function statusFromExecution(execution: TestRunResultIR): Scenario3Result['status'] {
  if (execution.status === 'error') return 'error';
  if (execution.status === 'failed') return 'failed';
  if (execution.status === 'partial') return execution.summary.failed > 0 ? 'failed' : 'blocked';
  return 'passed';
}

function buildTrace(requirements: RequirementIR, testPlan: TestPlanIR, dataPlan?: TestDataPlanIR, execution?: TestRunResultIR): Scenario3TraceGraph {
  const nodes: Scenario3TraceNode[] = [];
  const edges: Scenario3TraceGraph['edges'] = [];
  const add = (node: Scenario3TraceNode) => { if (!nodes.some((n) => n.id === node.id)) nodes.push(node); };
  const link = (from: string, to: string, relation: Scenario3TraceRelation) => edges.push({ from, to, relation });
  for (const req of requirements.requirements) {
    const reqId = `requirement:${req.id}`;
    add({ id: reqId, kind: 'requirement', ref: req.id, metadata: { title: req.title } });
    for (const provenance of req.provenance) {
      const sourceId = `source:${provenance.contextId}`;
      add({ id: sourceId, kind: 'source', ref: provenance.contextId, metadata: { ...provenance } });
      link(sourceId, reqId, 'SOURCE_SUPPORTS_REQUIREMENT');
    }
  }
  for (const scenario of testPlan.scenarios) {
    const id = `scenario:${scenario.id}`;
    add({ id, kind: 'scenario', ref: scenario.id });
    for (const reqId of scenario.requirementIds) link(`requirement:${reqId}`, id, 'REQUIREMENT_COVERED_BY_SCENARIO');
  }
  for (const tc of testPlan.testCases) {
    const tcId = `test-case:${tc.id}`;
    add({ id: tcId, kind: 'test-case', ref: tc.id });
    link(`scenario:${tc.scenarioId}`, tcId, 'SCENARIO_IMPLEMENTED_BY_TESTCASE');
    for (let i = 0; i < tc.expectedResults.length; i++) {
      const erId = `expected:${tc.id}:${i}`;
      const vnId = `verification:${tc.id}:${i}`;
      add({ id: erId, kind: 'expected-result', ref: erId, metadata: tc.expectedResults[i]!.verificationIntent ? { ...tc.expectedResults[i]!.verificationIntent } : undefined });
      add({ id: vnId, kind: 'verification-need', ref: vnId, metadata: tc.expectedResults[i]!.verificationIntent ? { ...tc.expectedResults[i]!.verificationIntent } : undefined });
      link(tcId, erId, 'TESTCASE_EXPECTS_RESULT');
      link(erId, vnId, 'EXPECTED_RESULT_VERIFIED_BY_NEED');
    }
    for (const need of tc.dataNeeds) {
      const needId = `data-need:${need.id}`;
      add({ id: needId, kind: 'data-need', ref: need.id, metadata: { description: need.description } });
      link(tcId, needId, 'TESTCASE_REQUIRES_DATA');
    }
  }
  for (const item of dataPlan?.dataItems ?? []) {
    const id = `data-item:${item.id}`;
    add({ id, kind: 'data-item', ref: item.id, metadata: { lifecycle: item.lifecycle } });
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
      const assertion = evidence.assertionId ? result.assertions.find((a) => a.id === evidence.assertionId) : undefined;
      if (assertion) {
        const vnId = `verification:${result.testCaseId}:${assertion.expectedResultIndex}`;
        link(vnId, evidenceId, 'VERIFICATION_NEED_SUPPORTED_BY_EVIDENCE');
        linkedEvidence.add(evidenceId);
      }
    }
  }
  return { nodes, edges, orphanEvidenceIds: [...evidenceIds].filter((id) => !linkedEvidence.has(id)) };
}

function aggregateRequirements(testPlan: TestPlanIR, execution: TestRunResultIR): Scenario3RequirementResult[] {
  return testPlan.scope.requirementIds.map((requirementId) => {
    const results = execution.testResults.filter((result) => result.requirementIds.includes(requirementId));
    const status: Scenario3RequirementResult['status'] = results.some((r) => r.status === 'error') ? 'error' : results.some((r) => r.status === 'failed') ? 'failed' : results.some((r) => r.status === 'blocked' || r.status === 'skipped') ? 'blocked' : 'passed';
    return { requirementId, status, testCaseIds: results.map((r) => r.testCaseId), evidenceIds: results.flatMap((r) => r.evidence.map((e) => e.id)), traceNodeId: `requirement:${requirementId}` };
  });
}
