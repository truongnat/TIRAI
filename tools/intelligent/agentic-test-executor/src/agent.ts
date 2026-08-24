// ---------------------------------------------------------------------------
// Agentic Test Executor — core agent loop
// ---------------------------------------------------------------------------

import type { AIProvider } from 'ai-provider';
import type {
  BrowserSession,
  BrowserPage,
} from 'ui-executor';
import type {
  TestExecutor,
  TestExecutorMatch,
  TestExecutorValidation,
  TestExecutorResult,
  TestCleanupResult,
  TestCase,
  TestExecutionContext,
  TestStepExecutionResult,
  AssertionResult,
  EvidenceReference,
  TestExecutionError,
  TestExecutionWarning,
} from 'test-execution-orchestrator';
import {
  type AgentCapabilities,
  type AgentExecutionPolicy,
  type AgentMetrics,
  type AgenticStepResult,
  type AgenticAssertionResult,
  type BrowserObservation,
  defaultAgentPolicy,
  defaultCapabilities,
} from './models.js';
import { validateCapabilities } from './capability/capability-model.js';
import { observeBrowser } from './observation/browser-observer.js';
import { ElementIdMap } from './observation/element-id-map.js';
import { groundStep } from './grounding/step-grounding.js';
import { groundAssertion } from './assertion/assertion-grounding.js';
import { validateAction } from './action/action-validator.js';
import { executeAction } from './action/action-executor.js';

export interface AgenticTestExecutorOptions {
  browserSession: BrowserSession;
  aiProvider: AIProvider;
  baseUrl: string;
  capabilities?: AgentCapabilities;
  policy?: AgentExecutionPolicy;
  allowedOrigins?: string[];
}

export class AgenticTestExecutor implements TestExecutor {
  readonly type = 'ui';

  private readonly browserSession: BrowserSession;
  private readonly aiProvider: AIProvider;
  private readonly baseUrl: string;
  private readonly capabilities: AgentCapabilities;
  private readonly policy: AgentExecutionPolicy;
  private readonly allowedOrigins: string[];

  constructor(options: AgenticTestExecutorOptions) {
    this.browserSession = options.browserSession;
    this.aiProvider = options.aiProvider;
    this.baseUrl = options.baseUrl;
    this.capabilities = options.capabilities ?? defaultCapabilities();
    this.policy = options.policy ?? defaultAgentPolicy();
    this.allowedOrigins = options.allowedOrigins ?? ['http://127.0.0.1', 'http://localhost'];
  }

  canExecute(_testCase: TestCase, _context: TestExecutionContext): TestExecutorMatch {
    const capCheck = validateCapabilities({ browser: 'AVAILABLE' }, this.capabilities);
    if (!capCheck.supported) {
      return { supported: false, score: 0, reasons: ['Browser capability not available'] };
    }
    return { supported: true, score: 0.8, reasons: ['Agentic executor — autonomous grounding'] };
  }

  async validate(testCase: TestCase, _context: TestExecutionContext): Promise<TestExecutorValidation> {
    const errors: TestExecutionWarning[] = [];
    if (testCase.steps.length === 0) {
      errors.push({ code: 'AGENT_NO_STEPS', message: 'Test case has no steps' });
    }
    return { valid: errors.length === 0, errors };
  }

  async execute(testCase: TestCase, context: TestExecutionContext): Promise<TestExecutorResult> {
    const metrics = this.createEmptyMetrics();
    const stepResults: AgenticStepResult[] = [];
    const assertionResults: AgenticAssertionResult[] = [];
    const evidenceRefs: EvidenceReference[] = [];
    const errors: TestExecutionError[] = [];
    const warnings: TestExecutionWarning[] = [];

    let page: BrowserPage;
    try {
      await this.browserSession.start({
        baseUrl: this.baseUrl,
        allowedOrigins: this.allowedOrigins,
        headless: true,
      });
      const sessionWithIsolatedPage = this.browserSession as BrowserSession & { createIsolatedPage?: () => Promise<BrowserPage> };
      if (sessionWithIsolatedPage.createIsolatedPage) {
        page = await sessionWithIsolatedPage.createIsolatedPage();
      } else {
        page = this.browserSession.page();
      }
      await page.goto(this.baseUrl);
    } catch (err) {
      return {
        status: 'error',
        steps: [],
        assertions: [],
        evidence: [],
        error: {
          code: 'AGENT_BROWSER_ERROR',
          message: `Failed to start browser: ${err instanceof Error ? err.message : String(err)}`,
          retryable: false,
        },
        warnings: [],
      };
    }

    try {
      for (const step of testCase.steps) {
        if (metrics.actions >= this.policy.maxActionsPerTest) {
          errors.push({ code: 'AGENT_ACTION_BUDGET_EXCEEDED', message: 'Action budget exceeded', retryable: false });
          break;
        }

        const stepResult = await this.executeStep(testCase, step, page, context, metrics, evidenceRefs);
        stepResults.push(stepResult);

        if (stepResult.status === 'blocked') {
          break;
        }
      }

      for (let i = 0; i < testCase.expectedResults.length; i++) {
        const expected = testCase.expectedResults[i];
        if (metrics.agentCalls >= this.policy.maxAgentCalls) {
          assertionResults.push({
            expectedResultIndex: i,
            description: expected.description,
            grounding: {
              testCaseId: testCase.id,
              expectedResultIndex: i,
              assertionType: 'text-visible',
              confidence: 'low',
              reasoning: 'Agent call budget exhausted',
              unresolvedReason: 'AGENT_ASSERTION_UNRESOLVED',
            },
            status: 'blocked',
            evidenceIds: [],
          });
          continue;
        }

        const assertionResult = await this.evaluateAssertion(testCase, i, expected, page, context, metrics, evidenceRefs);
        assertionResults.push(assertionResult);
      }

      const overallStatus = this.computeOverallStatus(stepResults, assertionResults, errors);

      return {
        status: overallStatus,
        steps: stepResults.map(toStepExecutionResult),
        assertions: assertionResults.map(toAssertionResult),
        evidence: evidenceRefs,
        warnings,
      };
    } catch (err) {
      return {
        status: 'error',
        steps: stepResults.map(toStepExecutionResult),
        assertions: assertionResults.map(toAssertionResult),
        evidence: evidenceRefs,
        error: {
          code: 'AGENT_BROWSER_ERROR',
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        },
        warnings,
      };
    }
  }

  async cleanup(_testCase: TestCase, _context: TestExecutionContext): Promise<TestCleanupResult> {
    try {
      await this.browserSession.close();
    } catch {
      // Best effort cleanup
    }
    return { status: 'succeeded' };
  }

  // ---- Step execution with replan loop ------------------------------------

  private async executeStep(
    testCase: TestCase,
    step: { order: number; action: string; target?: string; input?: string },
    page: BrowserPage,
    context: TestExecutionContext,
    metrics: AgentMetrics,
    _evidenceRefs: EvidenceReference[],
  ): Promise<AgenticStepResult> {
    let replans = 0;
    let previousFailure: string | undefined;

    while (replans <= this.policy.maxReplans) {
      if (metrics.agentCalls >= this.policy.maxAgentCalls) {
        return {
          stepOrder: step.order,
          intent: step.action,
          grounding: {
            testCaseId: testCase.id,
            stepIndex: step.order,
            stepIntent: step.action,
            candidateActions: [],
            confidence: 'low',
            reasoning: 'Agent call budget exhausted',
            unresolvedReason: 'AGENT_ACTION_BUDGET_EXCEEDED',
          },
          status: 'blocked',
          replans,
          evidenceIds: [],
          error: 'AGENT_ACTION_BUDGET_EXCEEDED',
        };
      }

      let observation: BrowserObservation;
      try {
        observation = await observeBrowser(page);
        metrics.observations++;
      } catch (err) {
        return {
          stepOrder: step.order,
          intent: step.action,
          grounding: {
            testCaseId: testCase.id,
            stepIndex: step.order,
            stepIntent: step.action,
            candidateActions: [],
            confidence: 'low',
            reasoning: 'Observation failed',
            unresolvedReason: 'AGENT_BROWSER_ERROR',
          },
          status: 'blocked',
          replans,
          evidenceIds: [],
          error: `Observation failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      let grounding;
      try {
        metrics.agentCalls++;
        grounding = await groundStep(this.aiProvider, {
          testCaseId: testCase.id,
          stepIndex: step.order,
          stepDescription: step.action,
          stepTarget: step.target,
          stepInput: step.input,
          observation,
          previousFailure,
        });
      } catch (err) {
        return {
          stepOrder: step.order,
          intent: step.action,
          grounding: {
            testCaseId: testCase.id,
            stepIndex: step.order,
            stepIntent: step.action,
            candidateActions: [],
            confidence: 'low',
            reasoning: 'Grounding AI call failed',
            unresolvedReason: 'AGENT_GROUNDING_FAILED',
          },
          status: 'blocked',
          replans,
          evidenceIds: [],
          error: `Grounding failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (!grounding.action) {
        if (replans < this.policy.maxReplans) {
          previousFailure = grounding.unresolvedReason ?? 'No action proposed';
          replans++;
          metrics.replans++;
          metrics.groundingFailures++;
          continue;
        }
        return {
          stepOrder: step.order,
          intent: step.action,
          grounding,
          status: 'blocked',
          replans,
          evidenceIds: [],
          error: grounding.unresolvedReason ?? 'No action proposed after all replans',
        };
      }

      const idMap = ElementIdMap.fromObservation(observation);
      const validation = validateAction(grounding.action, observation, this.policy, {
        navigationActions: metrics.navigationActions,
        totalActions: metrics.actions,
      });

      if (!validation.valid) {
        if (replans < this.policy.maxReplans) {
          previousFailure = validation.reason;
          replans++;
          metrics.replans++;
          continue;
        }
        return {
          stepOrder: step.order,
          intent: step.action,
          grounding,
          status: 'blocked',
          replans,
          evidenceIds: [],
          error: validation.reason,
        };
      }

      const result = await executeAction(page, grounding.action, idMap);
      metrics.actions++;
      if (grounding.action.type === 'navigate') metrics.navigationActions++;

      if (result.success && (grounding.action.type === 'click' || grounding.action.type === 'navigate')) {
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!result.success) {
        if (replans < this.policy.maxReplans) {
          previousFailure = result.error;
          replans++;
          metrics.replans++;
          continue;
        }
        return {
          stepOrder: step.order,
          intent: step.action,
          grounding,
          action: grounding.action,
          status: 'failed',
          replans,
          evidenceIds: [],
          error: result.error,
        };
      }

      return {
        stepOrder: step.order,
        intent: step.action,
        grounding,
        action: grounding.action,
        status: 'passed',
        replans,
        evidenceIds: [],
      };
    }

    return {
      stepOrder: step.order,
      intent: step.action,
      grounding: {
        testCaseId: testCase.id,
        stepIndex: step.order,
        stepIntent: step.action,
        candidateActions: [],
        confidence: 'low',
        reasoning: 'Replan budget exhausted',
        unresolvedReason: 'AGENT_REPLAN_BUDGET_EXCEEDED',
      },
      status: 'blocked',
      replans,
      evidenceIds: [],
      error: 'AGENT_REPLAN_BUDGET_EXCEEDED',
    };
  }

  // ---- Assertion evaluation -----------------------------------------------

  private async evaluateAssertion(
    testCase: TestCase,
    index: number,
    expected: { description: string; verificationType: string; target?: string },
    page: BrowserPage,
    context: TestExecutionContext,
    metrics: AgentMetrics,
    _evidenceRefs: EvidenceReference[],
  ): Promise<AgenticAssertionResult> {
    let observation: BrowserObservation;
    try {
      observation = await observeBrowser(page);
      metrics.observations++;
    } catch {
      return {
        expectedResultIndex: index,
        description: expected.description,
        grounding: {
          testCaseId: testCase.id,
          expectedResultIndex: index,
          assertionType: 'text-visible',
          confidence: 'low',
          reasoning: 'Observation failed',
          unresolvedReason: 'AGENT_BROWSER_ERROR',
        },
        status: 'blocked',
        evidenceIds: [],
      };
    }

    let grounding;
    try {
      metrics.agentCalls++;
      grounding = await groundAssertion(this.aiProvider, {
        testCaseId: testCase.id,
        expectedResultIndex: index,
        expectedDescription: expected.description,
        verificationType: expected.verificationType,
        observation,
      });
    } catch {
      return {
        expectedResultIndex: index,
        description: expected.description,
        grounding: {
          testCaseId: testCase.id,
          expectedResultIndex: index,
          assertionType: 'text-visible',
          confidence: 'low',
          reasoning: 'Assertion grounding AI call failed',
          unresolvedReason: 'AGENT_ASSERTION_UNRESOLVED',
        },
        status: 'blocked',
        evidenceIds: [],
      };
    }

    if (grounding.unresolvedReason) {
      return {
        expectedResultIndex: index,
        description: expected.description,
        grounding,
        status: 'blocked',
        evidenceIds: [],
      };
    }

    metrics.assertions++;
    const assertionStatus = this.verifyAssertion(page, observation, grounding);

    return {
      expectedResultIndex: index,
      description: expected.description,
      grounding,
      status: assertionStatus,
      evidenceIds: [],
    };
  }

  private verifyAssertion(
    page: BrowserPage,
    observation: BrowserObservation,
    grounding: AgenticAssertionResult['grounding'],
  ): 'passed' | 'failed' | 'blocked' {
    switch (grounding.assertionType) {
      case 'text-visible': {
        if (!grounding.expectedValue) return 'blocked';
        const allText = `${observation.pageText} ${observation.headings.join(' ')}`.toLowerCase();
        return allText.includes(grounding.expectedValue.toLowerCase()) ? 'passed' : 'failed';
      }

      case 'element-visible': {
        if (!grounding.elementId) return 'blocked';
        const el = observation.elements.find((e) => e.id === grounding.elementId);
        return el ? 'passed' : 'failed';
      }

      case 'element-absent': {
        if (!grounding.elementId) return 'passed';
        const el = observation.elements.find((e) => e.id === grounding.elementId);
        return el ? 'failed' : 'passed';
      }

      case 'url-contains': {
        if (!grounding.expectedValue) return 'blocked';
        return observation.url.includes(grounding.expectedValue) ? 'passed' : 'failed';
      }

      case 'url-equals': {
        if (!grounding.expectedValue) return 'blocked';
        return observation.url === grounding.expectedValue ? 'passed' : 'failed';
      }

      case 'value-equals': {
        if (!grounding.elementId || !grounding.expectedValue) return 'blocked';
        const el = observation.elements.find((e) => e.id === grounding.elementId);
        if (!el) return 'blocked';
        return el.visibleText === grounding.expectedValue ? 'passed' : 'failed';
      }

      case 'title-contains': {
        if (!grounding.expectedValue) return 'blocked';
        return observation.title.toLowerCase().includes(grounding.expectedValue.toLowerCase()) ? 'passed' : 'failed';
      }

      case 'title-equals': {
        if (!grounding.expectedValue) return 'blocked';
        return observation.title === grounding.expectedValue ? 'passed' : 'failed';
      }

      default:
        return 'blocked';
    }
  }

  // ---- Status computation -------------------------------------------------

  private computeOverallStatus(
    steps: AgenticStepResult[],
    assertions: AgenticAssertionResult[],
    errors: TestExecutionError[],
  ): 'passed' | 'failed' | 'blocked' | 'error' {
    if (errors.some((e) => e.code === 'AGENT_BROWSER_ERROR')) return 'error';

    const hasBlocked = steps.some((s) => s.status === 'blocked') ||
      assertions.some((a) => a.status === 'blocked');
    if (hasBlocked) return 'blocked';

    const hasFailed = steps.some((s) => s.status === 'failed') ||
      assertions.some((a) => a.status === 'failed');
    if (hasFailed) return 'failed';

    const allPassed = steps.every((s) => s.status === 'passed' || s.status === 'skipped') &&
      assertions.every((a) => a.status === 'passed');
    if (allPassed) return 'passed';

    return 'failed';
  }

  // ---- Metrics ------------------------------------------------------------

  private createEmptyMetrics(): AgentMetrics {
    return {
      agentCalls: 0,
      observations: 0,
      actions: 0,
      replans: 0,
      groundingFailures: 0,
      navigationActions: 0,
      assertions: 0,
      evidenceCount: 0,
    };
  }
}

// ---- Result mapping -------------------------------------------------------

function toStepExecutionResult(step: AgenticStepResult): TestStepExecutionResult {
  return {
    order: step.stepOrder,
    action: step.intent,
    status: step.status,
    evidenceIds: step.evidenceIds,
    error: step.error ? { code: 'AGENT_STEP_FAILED', message: step.error, retryable: false } : undefined,
  };
}

function toAssertionResult(assertion: AgenticAssertionResult): AssertionResult {
  return {
    id: `ASSERT-${String(assertion.expectedResultIndex + 1).padStart(4, '0')}`,
    expectedResultIndex: assertion.expectedResultIndex,
    description: assertion.description,
    verificationType: 'ui',
    status: assertion.status,
    actual: assertion.grounding.expectedValue,
    evidenceIds: assertion.evidenceIds,
  };
}
