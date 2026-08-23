// Test Execution Orchestrator v1 — Fake test executor.
//
// Configurable executor for testing. Supports success, failure, blocked,
// error, timeout, step results, assertion results, evidence, delay, and
// call capture. Most tests use this executor.

import type {
  TestCase,
  TestExecutor,
  TestExecutorMatch,
  TestExecutorValidation,
  TestExecutorResult,
  TestExecutionContext,
  TestExecutorType,
  TestStepExecutionResult,
  AssertionResult,
  TestCleanupResult,
  TestExecutionWarning,
} from '../models.js';

export interface FakeTestExecutorConfig {
  executorType?: TestExecutorType;
  resultStatus?: 'passed' | 'failed' | 'blocked' | 'error';
  steps?: TestStepExecutionResult[];
  assertions?: AssertionResult[];
  evidence?: Array<{ type: 'screenshot' | 'log' | 'text' | 'other'; artifactRef?: string }>;
  delayMs?: number;
  shouldError?: boolean;
  errorMessage?: string;
  shouldTimeout?: boolean;
  cleanupStatus?: 'succeeded' | 'failed' | 'skipped';
  canHandle?: (testCase: TestCase) => boolean;
  score?: number;
}

export class FakeTestExecutor implements TestExecutor {
  readonly type: TestExecutorType;
  private config: FakeTestExecutorConfig;
  private callCount = 0;
  private capturedCalls: TestCase[] = [];

  constructor(config: FakeTestExecutorConfig = {}) {
    this.type = config.executorType ?? 'fake';
    this.config = config;
  }

  canExecute(testCase: TestCase, _context: TestExecutionContext): TestExecutorMatch {
    if (this.config.canHandle) {
      const canHandle = this.config.canHandle(testCase);
      return { supported: canHandle, score: canHandle ? (this.config.score ?? 0.8) : 0, reasons: canHandle ? ['FakeTestExecutor configured for this case'] : [] };
    }
    // By default, handle all test cases
    return { supported: true, score: this.config.score ?? 0.5, reasons: ['FakeTestExecutor accepts all'] };
  }

  async validate(_testCase: TestCase, _context: TestExecutionContext): Promise<TestExecutorValidation> {
    return { valid: true, errors: [] };
  }

  async execute(testCase: TestCase, context: TestExecutionContext): Promise<TestExecutorResult> {
    this.callCount++;
    this.capturedCalls.push(testCase);

    // Simulate delay
    if (this.config.delayMs && this.config.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.delayMs));
    }

    // Simulate error
    if (this.config.shouldError) {
      return {
        status: 'error',
        steps: [],
        assertions: [],
        evidence: [],
        error: {
          code: 'TEST_EXECUTOR_ERROR',
          message: this.config.errorMessage ?? 'FakeTestExecutor simulated error',
          retryable: false,
          executorType: this.type,
        },
        warnings: [],
      };
    }

    // Build step results
    const steps: TestStepExecutionResult[] = this.config.steps ?? testCase.steps.map((s) => ({
      order: s.order,
      action: s.action,
      status: 'passed' as const,
      startedAt: context.clock.nowIso(),
      finishedAt: context.clock.nowIso(),
      evidenceIds: [],
    }));

    // Build assertion results
    const assertions: AssertionResult[] = this.config.assertions ?? testCase.expectedResults.map((er, idx) => {
      let assertionStatus: AssertionResult['status'] = 'passed';
      if (this.config.resultStatus === 'failed' && idx === 0) {
        assertionStatus = 'failed';
      } else if (this.config.resultStatus === 'blocked' && idx === 0) {
        assertionStatus = 'blocked';
      }
      return {
        id: `ASR-${String(idx + 1).padStart(3, '0')}`,
        expectedResultIndex: idx,
        description: er.description,
        verificationType: er.verificationType,
        status: assertionStatus,
        evidenceIds: [],
      };
    });

    // Build evidence
    const evidence = (this.config.evidence ?? []).map((_e, _idx) =>
      context.evidence.add({
        type: _e.type,
        sourceExecutor: this.type,
        testCaseId: testCase.id,
        artifactRef: _e.artifactRef,
      }),
    );
    // Suppress unused variable warning
    void evidence;

    const status = this.config.resultStatus === 'blocked' ? 'blocked'
      : this.config.resultStatus === 'error' ? 'error'
      : this.config.resultStatus === 'failed' ? 'failed'
      : 'passed';

    const warnings: TestExecutionWarning[] = [];

    return {
      status,
      steps,
      assertions,
      evidence: context.evidence.list().filter((e) => e.testCaseId === testCase.id),
      warnings,
    };
  }

  async cleanup(_testCase: TestCase, _context: TestExecutionContext): Promise<TestCleanupResult> {
    const status = this.config.cleanupStatus ?? 'succeeded';
    return {
      status,
      startedAt: _context.clock.nowIso(),
      finishedAt: _context.clock.nowIso(),
      error: status === 'failed' ? {
        code: 'TEST_CLEANUP_FAILED',
        message: 'FakeTestExecutor simulated cleanup failure',
        retryable: false,
        executorType: this.type,
      } : undefined,
    };
  }

  getCallCount(): number {
    return this.callCount;
  }

  getCapturedCalls(): TestCase[] {
    return [...this.capturedCalls];
  }

  resetCapture(): void {
    this.callCount = 0;
    this.capturedCalls = [];
  }
}
