import type { TestPlanIR, TestCase, TestPlannerWarning } from 'test-planner';
import type { TestDataPlanIR } from 'test-data-planner';

/** The minimum semantic source accepted by the Scenario 3 coordinator. */
export interface Scenario3Specification<TSpecification = unknown> {
  specification: TSpecification;
  sourceIntelligence?: unknown;
}

/** Stage adapters keep package ownership while removing filesystem handoff. */
export interface Scenario3StageAdapters<TSpecification = unknown, TRequirementIR = unknown> {
  buildRequirements(input: Scenario3Specification<TSpecification>): Promise<TRequirementIR>;
  buildTestPlan(requirements: TRequirementIR, sourceIntelligence?: unknown): Promise<TestPlanIR>;
  buildTestDataPlan(testPlan: TestPlanIR): Promise<TestDataPlanIR>;
}

export interface Scenario3ExecutionAdapter<TResult = unknown> {
  execute(testCases: TestCase[], dataPlan: TestDataPlanIR): Promise<TResult>;
}

export interface Scenario3PipelineResult<TResult = unknown, TRequirementIR = unknown> {
  requirements: TRequirementIR;
  testPlan: TestPlanIR;
  dataPlan?: TestDataPlanIR;
  execution?: TResult;
  status: 'passed' | 'blocked' | 'failed' | 'error';
  warnings: TestPlannerWarning[];
}

/**
 * Programmatic Specification → Test Plan → Data Plan → Scenario 2 bridge.
 *
 * The coordinator deliberately does not reimplement any planner or executor.
 * Callers provide package-owned stage adapters; the resulting IR stays in
 * memory and is passed to the normal execution adapter as one lifecycle.
 */
export class Scenario3Pipeline<
  TSpecification = unknown,
  TRequirementIR = unknown,
  TResult = unknown,
> {
  constructor(private readonly stages: Scenario3StageAdapters<TSpecification, TRequirementIR>) {}

  async run(
    input: Scenario3Specification<TSpecification>,
    execution?: Scenario3ExecutionAdapter<TResult>,
  ): Promise<Scenario3PipelineResult<TResult, TRequirementIR>> {
    let requirements: TRequirementIR;
    let testPlan: TestPlanIR;

    try {
      requirements = await this.stages.buildRequirements(input);
      testPlan = await this.stages.buildTestPlan(requirements, input.sourceIntelligence);
    } catch (error) {
      return {
        requirements: undefined as TRequirementIR,
        testPlan: undefined as unknown as TestPlanIR,
        status: 'error',
        warnings: [{ code: 'SCENARIO3_PLANNING_ERROR', message: String(error) }],
      };
    }

    const warnings = testPlan.warnings ?? [];
    if (hasPlanningBlocker(warnings)) {
      return { requirements, testPlan, status: 'blocked', warnings };
    }

    let dataPlan: TestDataPlanIR;
    try {
      dataPlan = await this.stages.buildTestDataPlan(testPlan);
    } catch (error) {
      return {
        requirements,
        testPlan,
        status: 'error',
        warnings: [...warnings, { code: 'SCENARIO3_DATA_PLAN_ERROR', message: String(error) }],
      };
    }

    if (!execution) {
      return { requirements, testPlan, dataPlan, status: 'passed', warnings };
    }

    try {
      const result = await execution.execute(testPlan.testCases, dataPlan);
      return {
        requirements,
        testPlan,
        dataPlan,
        execution: result,
        status: statusFromExecution(result),
        warnings,
      };
    } catch (error) {
      return {
        requirements,
        testPlan,
        dataPlan,
        status: 'error',
        warnings: [...warnings, { code: 'SCENARIO3_EXECUTION_ERROR', message: String(error) }],
      };
    }
  }
}

function hasPlanningBlocker(warnings: TestPlannerWarning[]): boolean {
  return warnings.some((warning) =>
    [
      'TEST_CASE_NON_EXECUTABLE',
      'TEST_CASE_INVALID_STEP_ORDER',
      'TEST_CASE_UNSUPPORTED_AUTOMATION',
      'TEST_EXPECTATION_UNTRACEABLE',
      'TEST_REQUIREMENT_NOT_COVERED',
    ].includes(warning.code),
  );
}

function statusFromExecution(result: unknown): 'passed' | 'blocked' | 'failed' | 'error' {
  if (typeof result === 'object' && result !== null && 'status' in result) {
    const status = (result as { status?: unknown }).status;
    if (status === 'blocked' || status === 'failed' || status === 'error') return status;
  }
  return 'passed';
}
