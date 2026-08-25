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
  type DataResolutionMetrics,
  type AgentMetrics,
  type DataResolutionResult,
  type AgenticStepResult,
  type AgenticAssertionResult,
  type AgenticAction,
  type BrowserObservation,
  type TestDataItem,
  defaultAgentPolicy,
  defaultCapabilities,
} from './models.js';
import type { PreparationMutationPolicy } from './data/preparation-lifecycle.js';
import { validateCapabilities } from './capability/capability-model.js';
import { normalizeBaseUrl } from './runtime/base-url.js';
import { observeBrowser } from './observation/browser-observer.js';
import { ElementIdMap } from './observation/element-id-map.js';
import { groundStep } from './grounding/step-grounding.js';
import { groundAssertion } from './assertion/assertion-grounding.js';
import { validateAction } from './action/action-validator.js';
import { executeAction } from './action/action-executor.js';
import {
  DataNeedCoordinator,
  DataNeedCoordinatorError,
} from './data/data-need-coordinator.js';
import {
  buildRuntimeCapabilityInventory,
  type RuntimeCapabilityInventory,
} from './data/runtime-capability-inventory.js';
import type { RuntimeDataStore } from './data/runtime-data-store.js';

export interface AgenticTestExecutorOptions {
  browserSession: BrowserSession;
  aiProvider: AIProvider;
  baseUrl: string;
  capabilities?: AgentCapabilities;
  policy?: AgentExecutionPolicy;
  allowedOrigins?: string[];
  /** Phase 1 data items to resolve before any browser side effect. */
  testDataItems?: TestDataItem[];
  /** Explicit Phase 2B operation-level capabilities; defaults fail-closed. */
  capabilityInventory?: Partial<RuntimeCapabilityInventory>;
  /** Explicit policy for mutable test-state preparation; defaults fail-closed. */
  preparationPolicy?: Partial<PreparationMutationPolicy>;
  generationSeed?: string;
}

export class AgenticTestExecutor implements TestExecutor {
  readonly type = 'ui';

  private readonly browserSession: BrowserSession;
  private readonly aiProvider: AIProvider;
  private readonly baseUrl: string;
  private readonly capabilities: AgentCapabilities;
  private readonly policy: AgentExecutionPolicy;
  private readonly allowedOrigins: string[];
  private readonly testDataItems: TestDataItem[];
  private readonly dataNeedCoordinator: DataNeedCoordinator;
  private lastDataResolutions: DataResolutionResult[] = [];
  private lastDataResolutionMetrics: DataResolutionMetrics = emptyDataResolutionMetrics();
  private lastMetrics: AgentMetrics = {
    agentCalls: 0,
    observations: 0,
    actions: 0,
    replans: 0,
    groundingFailures: 0,
    navigationActions: 0,
    assertions: 0,
    evidenceCount: 0,
  };

  constructor(options: AgenticTestExecutorOptions) {
    this.browserSession = options.browserSession;
    this.aiProvider = options.aiProvider;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.capabilities = options.capabilities ?? defaultCapabilities();
    this.policy = options.policy ?? defaultAgentPolicy();
    this.allowedOrigins = options.allowedOrigins ?? ['http://127.0.0.1', 'http://localhost'];
    this.testDataItems = options.testDataItems ?? [];
    this.dataNeedCoordinator = new DataNeedCoordinator({
      inventory: buildRuntimeCapabilityInventory(this.capabilities, options.capabilityInventory),
      preparationPolicy: options.preparationPolicy,
      generationSeed: options.generationSeed,
    });
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
    this.lastMetrics = metrics;
    const stepResults: AgenticStepResult[] = [];
    const assertionResults: AgenticAssertionResult[] = [];
    const evidenceRefs: EvidenceReference[] = [];
    const errors: TestExecutionError[] = [];
    const warnings: TestExecutionWarning[] = [];

    let coordination;
    try {
      coordination = await this.dataNeedCoordinator.prepare(this.testDataItems, {
        inputs: testCase.inputs.map((input) => ({
          name: input.name,
          value: input.value,
          valueStrategy: input.valueStrategy,
        })),
        bindings: context.bindings,
        secretProvider: context.secrets,
        runId: context.runId,
      });
    } catch (err) {
      const message = err instanceof DataNeedCoordinatorError
        ? err.message
        : `Data preparation failed: ${err instanceof Error ? err.message : String(err)}`;
      return {
        status: 'error',
        steps: [],
        assertions: [],
        evidence: [],
        error: {
          code: 'AGENT_DATA_PREPARATION_ERROR',
          message,
          retryable: false,
        },
        warnings: [],
      };
    }
    const dataResolutions = coordination.resolutions;
    this.lastDataResolutions = dataResolutions;
    this.lastDataResolutionMetrics = coordination.metrics;
    if (coordination.status === 'error') {
      return {
        status: 'error',
        steps: [],
        assertions: [],
        evidence: [],
        error: {
          code: 'AGENT_DATA_PREPARATION_ERROR',
          message: coordination.preparation?.warnings.join('; ') || 'Runtime test-state preparation failed.',
          retryable: false,
        },
        warnings,
      };
    }
    if (typeof context.bindings.produce === 'function') {
      for (const binding of coordination.runtimeData.toBindingResults()) {
        context.bindings.produce(binding);
      }
    }
    for (const proof of coordination.preparation?.proofs ?? []) {
      const evidence = addTextEvidence(context, {
        type: 'trace',
        sourceExecutor: proof.executor,
        testCaseId: testCase.id,
        metadata: {
          kind: 'data-preparation',
          dataItemId: proof.dataItemId,
          operationId: proof.operationId,
          action: proof.action,
          strategy: proof.strategy,
          ownership: proof.ownership,
          cleanupRequired: proof.cleanupRequired,
        },
        sensitive: false,
      });
      if (evidence) evidenceRefs.push(evidence);
    }

    const unresolvedData = dataResolutions.filter(
      (resolution) => resolution.status === 'NEEDS_CAPABILITY' || resolution.status === 'BLOCKED',
    );
    if (unresolvedData.length > 0) {
      const summary = unresolvedData
        .map((resolution) => `${resolution.dataItemId}: ${resolution.reason ?? 'unresolved'}`)
        .join('; ');
      warnings.push({
        code: 'AGENT_DATA_UNRESOLVED',
        message: summary,
      });
      return {
        status: 'blocked',
        steps: [],
        assertions: [],
        evidence: [],
        error: {
          code: 'AGENT_DATA_UNRESOLVED',
          message: summary,
          retryable: false,
        },
        warnings,
      };
    }

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

        const stepResult = await this.executeStep(
          testCase,
          step,
          page,
          context,
          coordination.runtimeData,
          metrics,
          evidenceRefs,
        );
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

  async cleanup(_testCase: TestCase, context: TestExecutionContext): Promise<TestCleanupResult> {
    try {
      await this.browserSession.close();
    } catch {
      // Best effort cleanup
    }
    const preparationCleanup = await this.dataNeedCoordinator.cleanup();
    context.bindings.clearSensitive?.();
    return { status: preparationCleanup.failed > 0 ? 'failed' : 'succeeded' };
  }

  // ---- Step execution with replan loop ------------------------------------

  private async executeStep(
    testCase: TestCase,
    step: { order: number; action: string; target?: string; input?: string },
    page: BrowserPage,
    context: TestExecutionContext,
    runtimeData: RuntimeDataStore,
    metrics: AgentMetrics,
    evidenceRefs: EvidenceReference[],
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
        if (metrics.observations >= this.policy.maxObservationRounds) {
          return this.blockedStep(testCase, step, replans, 'AGENT_OBSERVATION_BUDGET_EXCEEDED');
        }
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
      const resolution = await resolveActionValue(grounding.action, step.input, context, runtimeData);
      if (!resolution.action) {
        return {
          stepOrder: step.order,
          intent: step.action,
          grounding: sanitizeGrounding(grounding, step.input),
          status: 'blocked',
          replans,
          evidenceIds: [],
          error: resolution.error ?? 'Runtime value resolution failed',
        };
      }

      const recordedGrounding = sanitizeGrounding(grounding, step.input);
      const validation = await validateRuntimeAction(page, resolution.action, observation, idMap, this.policy, {
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
          grounding: recordedGrounding,
          status: 'blocked',
          replans,
          evidenceIds: [],
          error: validation.reason,
        };
      }

      const result = await executeAction(page, resolution.action, idMap);
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
          grounding: recordedGrounding,
          action: recordedGrounding.action,
          status: 'failed',
          replans,
          evidenceIds: [],
          error: result.error,
        };
      }

      const evidence = addTextEvidence(context, {
        type: 'text',
        sourceExecutor: 'ui',
        testCaseId: testCase.id,
        stepOrder: step.order,
        metadata: {
          kind: 'agent-action-observation',
          action: recordedGrounding.action?.type ?? 'unknown',
          elementId: recordedGrounding.action?.elementId,
          url: page.url(),
        },
        sensitive: false,
      });
      if (evidence) {
        evidenceRefs.push(evidence);
        metrics.evidenceCount = evidenceRefs.length;
      }

      return {
        stepOrder: step.order,
        intent: step.action,
        grounding: recordedGrounding,
        action: recordedGrounding.action,
        status: 'passed',
        replans,
        evidenceIds: evidence ? [evidence.id] : [],
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
    evidenceRefs: EvidenceReference[],
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
        observation: await redactObservationForAI(observation, testCase, context),
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
    const assertionId = `ASSERT-${String(index + 1).padStart(4, '0')}`;
    const evidence = addTextEvidence(context, {
      type: 'text',
      sourceExecutor: 'ui',
      testCaseId: testCase.id,
      assertionId,
      metadata: {
        kind: 'assertion-observation',
        status: assertionStatus,
        assertionType: grounding.assertionType,
        url: observation.url,
        title: observation.title,
        interactiveElementCount: observation.elements.length,
      },
      sensitive: false,
    });
    if (evidence) {
      evidenceRefs.push(evidence);
      metrics.evidenceCount = evidenceRefs.length;
    }

    return {
      expectedResultIndex: index,
      description: expected.description,
      grounding,
      status: assertionStatus,
      evidenceIds: evidence ? [evidence.id] : [],
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

  getLastMetrics(): Readonly<AgentMetrics> {
    return { ...this.lastMetrics };
  }

  /**
   * Returns the resolution proof without exposing in-process sensitive values.
   * Runtime executors may still use the private resolution values while the
   * result/evidence layer receives only references and provenance.
   */
  getLastDataResolutions(): ReadonlyArray<DataResolutionResult> {
    return this.lastDataResolutions.map((resolution) => {
      if (!resolution.sensitive) return { ...resolution };
      const { value: _value, ...safeResolution } = resolution;
      return safeResolution;
    });
  }

  getLastDataResolutionMetrics(): Readonly<DataResolutionMetrics> {
    return { ...this.lastDataResolutionMetrics };
  }

  private blockedStep(
    testCase: TestCase,
    step: { order: number; action: string; input?: string },
    replans: number,
    error: string,
  ): AgenticStepResult {
    return {
      stepOrder: step.order,
      intent: step.action,
      grounding: {
        testCaseId: testCase.id,
        stepIndex: step.order,
        stepIntent: step.action,
        candidateActions: [],
        confidence: 'low',
        reasoning: error,
        unresolvedReason: error,
      },
      status: 'blocked',
      replans,
      evidenceIds: [],
      error,
    };
  }
}

interface RuntimeActionResolution {
  action?: AgenticAction;
  error?: string;
}

async function resolveActionValue(
  action: AgenticAction,
  stepInput: string | undefined,
  context: TestExecutionContext,
  runtimeData?: RuntimeDataStore,
): Promise<RuntimeActionResolution> {
  if (action.type !== 'fill' && action.type !== 'select') return { action };

  const secretInput = stepInput?.startsWith('secret://') ? stepInput : undefined;
  const dataInput = stepInput?.startsWith('testdata://') ? stepInput : undefined;
  const source = secretInput ?? dataInput ?? action.valueSource ?? (action.value?.startsWith('secret://') ? action.value : undefined);

  if (source?.startsWith('secret://')) {
    if (action.value && action.value !== source) {
      return { error: 'Secret-backed fill must use valueSource; literal AI values are rejected.' };
    }
    const secretRef = source.slice('secret://'.length);
    try {
      const resolved = await context.secrets.resolve(secretRef);
      if (!resolved?.value) return { error: 'Secret resolution failed.' };
      return { action: { ...action, value: resolved.value, valueSource: source } };
    } catch {
      return { error: 'Secret resolution failed.' };
    }
  }

  if (source?.startsWith('testdata://')) {
    if (action.value && action.value !== source) {
      return { error: 'Runtime data fill must use valueSource; literal AI values are rejected.' };
    }
    const value = runtimeData?.resolve(source);
    if (typeof value !== 'string') return { error: 'Runtime data binding resolution failed.' };
    return { action: { ...action, value, valueSource: source } };
  }

  if (stepInput !== undefined) return { action: { ...action, value: stepInput } };
  return { action };
}

function sanitizeGrounding(
  grounding: AgenticStepResult['grounding'],
  stepInput: string | undefined,
): AgenticStepResult['grounding'] {
  if (!grounding.action || (!stepInput?.startsWith('secret://') && !stepInput?.startsWith('testdata://'))) return grounding;
  return {
    ...grounding,
    action: {
      ...grounding.action,
      value: undefined,
      valueSource: stepInput,
    },
  };
}

async function validateRuntimeAction(
  page: BrowserPage,
  action: AgenticAction,
  observation: BrowserObservation,
  idMap: ElementIdMap,
  policy: AgentExecutionPolicy,
  metrics: { navigationActions: number; totalActions: number },
): Promise<{ valid: boolean; reason?: string }> {
  const staticValidation = validateAction(action, observation, policy, metrics);
  if (!staticValidation.valid) return staticValidation;
  if (action.type === 'navigate' || action.type === 'observe') return staticValidation;

  const mapping = action.elementId ? idMap.get(action.elementId) : undefined;
  if (!mapping) return { valid: false, reason: `Element ${action.elementId ?? '(missing)'} is not mapped.` };

  try {
    const count = await page.count(mapping.locator);
    if (count !== 1) return { valid: false, reason: `Element ${action.elementId} is not unique in the current DOM.` };
    if (!(await page.isVisible(mapping.locator))) return { valid: false, reason: `Element ${action.elementId} is not visible.` };
    if (!(await page.isEnabled(mapping.locator))) return { valid: false, reason: `Element ${action.elementId} is disabled.` };
  } catch {
    return { valid: false, reason: `Element ${action.elementId} could not be deterministically validated.` };
  }
  return { valid: true };
}

async function redactObservationForAI(
  observation: BrowserObservation,
  testCase: TestCase,
  context: TestExecutionContext,
): Promise<BrowserObservation> {
  const secretValues: string[] = [];
  for (const step of testCase.steps) {
    if (!step.input?.startsWith('secret://')) continue;
    try {
      const secret = await context.secrets.resolve(step.input.slice('secret://'.length));
      if (secret?.value) secretValues.push(secret.value);
    } catch {
      // The execution path will report secret resolution failure if needed.
    }
  }
  if (secretValues.length === 0) return observation;
  const redact = (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    return secretValues.reduce((result, secret) => result.split(secret).join('[REDACTED]'), value);
  };
  return {
    ...observation,
    headings: observation.headings.map((heading) => redact(heading) ?? ''),
    pageText: redact(observation.pageText) ?? '',
    elements: observation.elements.map((element) => ({
      ...element,
      accessibleName: redact(element.accessibleName),
      label: redact(element.label),
      placeholder: redact(element.placeholder),
      visibleText: redact(element.visibleText),
    })),
  };
}

function addTextEvidence(
  context: TestExecutionContext,
  input: Parameters<TestExecutionContext['evidence']['add']>[0],
): EvidenceReference | undefined {
  const collector = context.evidence as unknown as { add?: (value: typeof input) => EvidenceReference };
  return typeof collector.add === 'function' ? collector.add(input) : undefined;
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

function emptyDataResolutionMetrics(): DataResolutionMetrics {
  return {
    dataNeeds: 0,
    resolvedDataNeeds: 0,
    generatedDataNeeds: 0,
    discoveredDataNeeds: 0,
    needsCapability: 0,
    blockedDataNeeds: 0,
    databaseDiscoveryCalls: 0,
    apiDiscoveryCalls: 0,
    browserDiscoveryRounds: 0,
  };
}
