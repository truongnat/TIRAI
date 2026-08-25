import type {
  AssertionResult,
  TestCase,
  TestCleanupResult,
  TestExecutionContext,
  TestExecutionError,
  TestExecutor,
  TestExecutorMatch,
  TestExecutorResult,
  TestExecutorValidation,
  TestStepExecutionResult,
} from 'test-execution-orchestrator';
import { JourneyAgent, type JourneyAgentOptions } from './journey-agent.js';
import type { JourneyExecutionResult } from './models.js';

/** Normal registry adapter for Phase 2C; it is explicitly enabled by the platform. */
export class JourneyTestExecutor implements TestExecutor {
  readonly type = 'ui' as const;
  private readonly agent: JourneyAgent;
  private lastResult?: JourneyExecutionResult;

  constructor(options: JourneyAgentOptions) {
    this.agent = new JourneyAgent(options);
  }

  canExecute(_testCase: TestCase, context: TestExecutionContext): TestExecutorMatch {
    if (!context.journeyEnabled) return { supported: false, score: 0, reasons: ['Journey execution is not enabled by the platform'] };
    return { supported: true, score: 0.9, reasons: ['Journey executor — explicit multi-page agentic execution'] };
  }

  async validate(testCase: TestCase, _context: TestExecutionContext): Promise<TestExecutorValidation> {
    const errors = testCase.steps.length === 0
      ? [{ code: 'JOURNEY_NO_STEPS', message: 'Test case has no steps' }]
      : [];
    return { valid: errors.length === 0, errors };
  }

  async execute(testCase: TestCase, context: TestExecutionContext): Promise<TestExecutorResult> {
    this.lastResult = await this.agent.execute(testCase, context);
    return mapJourneyResult(this.lastResult);
  }

  async cleanup(_testCase: TestCase, _context: TestExecutionContext): Promise<TestCleanupResult> {
    const result = await this.agent.cleanup();
    return result.status === 'succeeded'
      ? { status: 'succeeded' }
      : { status: 'failed', error: { code: result.error?.code ?? 'JOURNEY_CLEANUP_FAILED', message: result.error?.message ?? 'Journey cleanup failed', retryable: false, executorType: 'ui' } };
  }

  getLastJourneyResult(): JourneyExecutionResult | undefined {
    return this.lastResult;
  }
}

function mapJourneyResult(result: JourneyExecutionResult): TestExecutorResult {
  const steps: TestStepExecutionResult[] = result.journey.actionHistory.map((action, index) => ({
    order: index + 1,
    action: action.actionType === 'goBack' ? 'Recover through browser history' : `Grounded journey action: ${action.actionType}`,
    status: action.success ? 'passed' : 'failed',
    evidenceIds: [],
    ...(action.error ? { error: toError('JOURNEY_ACTION_FAILED', action.error) } : {}),
  }));
  // Intermediate observations are evidence, not final assertion failures.
  // The orchestrator classifies from this canonical assertion list.
  const assertions: AssertionResult[] = result.assertions.slice(-1).map((assertion, index) => ({
    id: `JOURNEY-ASSERT-${index + 1}`,
    expectedResultIndex: assertion.expectedResultIndex,
    description: assertion.description,
    verificationType: 'ui',
    status: assertion.status === 'not-verified' ? 'not-verified' : assertion.status,
    actual: assertion.actual,
    evidenceIds: assertion.evidenceIds,
  }));
  const error = result.error && result.status === 'error' ? toError(result.error.code, result.error.message) : undefined;
  return { status: result.status, steps, assertions, evidence: result.evidence, warnings: [], ...(error ? { error } : {}) };
}

function toError(code: string, message: string): TestExecutionError {
  return { code, message, retryable: false, executorType: 'ui' };
}
