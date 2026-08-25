import type { AIProvider } from 'ai-provider';
import type { BrowserPage, BrowserPageContext, BrowserSession } from 'ui-executor';
import type {
  TestCase,
  TestExecutionContext,
  EvidenceReference,
} from 'test-execution-orchestrator';
import { defaultCapabilities, type AgenticAssertionResult, type BrowserObservation, type TestDataItem } from '../models.js';
import { DataNeedCoordinator } from '../data/data-need-coordinator.js';
import type { PreparationMutationPolicy } from '../data/preparation-lifecycle.js';
import { buildRuntimeCapabilityInventory, type RuntimeCapabilityInventory } from '../data/runtime-capability-inventory.js';
import { observeBrowser } from '../observation/browser-observer.js';
import { ElementIdMap } from '../observation/element-id-map.js';
import { groundStep } from '../grounding/step-grounding.js';
import { groundAssertion } from '../assertion/assertion-grounding.js';
import { validateAction } from '../action/action-validator.js';
import { executeAction } from '../action/action-executor.js';
import { addTextEvidence, redactObservationForAI, resolveActionValue } from '../agent.js';
import {
  compactJourneyHistory,
  defaultJourneyPolicy,
  summarizeObservationState,
  type JourneyExecutionPolicy,
  type JourneyExecutionResult,
  type JourneyState,
  type JourneyMilestone,
  type JourneyDecision,
  type SemanticApplicationState,
  type JourneyPageContext,
} from './models.js';
import { classifyRuntimeFailure, decideRecovery } from './recovery.js';

export interface JourneyAgentOptions {
  browserSession: BrowserSession;
  aiProvider: AIProvider;
  baseUrl: string;
  capabilities?: ReturnType<typeof defaultCapabilities>;
  policy?: Partial<JourneyExecutionPolicy>;
  allowedOrigins?: string[];
  testDataItems?: TestDataItem[];
  capabilityInventory?: Partial<RuntimeCapabilityInventory>;
  preparationPolicy?: Partial<PreparationMutationPolicy>;
  generationSeed?: string;
}

/**
 * Phase 2C orchestration layer. It owns only journey state and bounded
 * planning; all browser grounding, validation, execution, data preparation,
 * and cleanup remain the Phase 2B primitives.
 */
export class JourneyAgent {
  private readonly browserSession: BrowserSession;
  private readonly aiProvider: AIProvider;
  private readonly baseUrl: string;
  private readonly policy: JourneyExecutionPolicy;
  private readonly allowedOrigins: string[];
  private readonly testDataItems: TestDataItem[];
  private readonly dataNeedCoordinator: DataNeedCoordinator;
  private cleaned = false;
  private lastCleanup: { status: 'succeeded' | 'failed'; error?: { code: string; message: string } } | undefined;

  constructor(options: JourneyAgentOptions) {
    this.browserSession = options.browserSession;
    this.aiProvider = options.aiProvider;
    this.baseUrl = options.baseUrl;
    this.policy = { ...defaultJourneyPolicy({
      maxActionsPerTest: 50,
      maxNavigationActions: 5,
      maxReplans: 3,
      maxAgentCalls: 20,
      maxObservationRounds: 20,
    }), ...options.policy };
    this.allowedOrigins = options.allowedOrigins ?? ['http://127.0.0.1', 'http://localhost'];
    this.testDataItems = options.testDataItems ?? [];
    this.dataNeedCoordinator = new DataNeedCoordinator({
      inventory: buildRuntimeCapabilityInventory(options.capabilities ?? defaultCapabilities(), options.capabilityInventory),
      preparationPolicy: options.preparationPolicy,
      generationSeed: options.generationSeed,
    });
  }

  async execute(testCase: TestCase, context: TestExecutionContext): Promise<JourneyExecutionResult> {
    const metrics = createJourneyMetrics();
    const evidence: EvidenceReference[] = [];
    const assertions: AgenticAssertionResult[] = [];
    const goal = testCase.expectedResults[0]?.description ?? testCase.steps.map((step) => step.action).join(' then ');
    const initialState = emptySemanticState(this.baseUrl);
    const milestone: JourneyMilestone = { id: 'MILESTONE-GOAL', intent: goal, status: 'pending', evidenceIds: [] };
    const journey: JourneyState = {
      testCaseId: testCase.id,
      goal,
      phase: 'planning',
      currentState: initialState,
      completedMilestones: [],
      pendingMilestones: [milestone],
      actionHistory: [],
      observationHistory: [],
      runtimeBindings: [],
      visitedLocations: [],
      recoveryAttempts: 0,
      loopDetections: 0,
      noProgressIterations: 0,
      pageContexts: [],
      recoveryHistory: [],
    };

    const coordination = await this.dataNeedCoordinator.prepare(this.testDataItems, {
      inputs: testCase.inputs.map((input) => ({ name: input.name, value: input.value, valueStrategy: input.valueStrategy })),
      bindings: context.bindings,
      secretProvider: context.secrets,
      runId: context.runId,
    });
    journey.runtimeBindings = coordination.runtimeData.safeSnapshot().map((binding) => binding.bindingRef);
    if (coordination.status === 'error') return this.finish(journey, metrics, evidence, assertions, 'error', 'JOURNEY_DATA_PREPARATION_ERROR');
    if (coordination.status === 'blocked' || coordination.resolutions.some((resolution) => !resolution.resolved)) {
      journey.phase = 'blocked';
      return this.finish(journey, metrics, evidence, assertions, 'blocked', 'JOURNEY_DATA_UNRESOLVED');
    }
    for (const binding of coordination.runtimeData.toBindingResults()) context.bindings.produce(binding);

    let page: BrowserPage;
    let activePageId: string | undefined;
    let knownPageIds = new Set<string>();
    try {
      await this.browserSession.start({ baseUrl: this.baseUrl, allowedOrigins: this.allowedOrigins, headless: true });
      const isolated = this.browserSession as BrowserSession & { createIsolatedPage?: () => Promise<BrowserPage> };
      page = isolated.createIsolatedPage ? await isolated.createIsolatedPage() : this.browserSession.page();
      await page.goto(this.baseUrl);
      const contexts = this.browserSession.pageContexts ? await this.browserSession.pageContexts() : [];
      activePageId = contexts.find((candidate) => candidate.active)?.id;
      knownPageIds = new Set(contexts.map((candidate) => candidate.id));
      journey.activePageId = activePageId;
      journey.pageContexts = contexts.map(toJourneyPageContext);
    } catch (error) {
      journey.phase = 'error';
      return this.finish(journey, metrics, evidence, assertions, 'error', 'JOURNEY_BROWSER_ERROR', error instanceof Error ? error.message : String(error));
    }

    journey.phase = 'executing';
    const seenDecisions = new Map<string, number>();
    let previousStateKey = '';
    try {
      for (let decision = 1; decision <= this.policy.maxJourneyDecisions; decision++) {
        if (metrics.observations >= this.policy.maxObservationRounds) return this.finish(journey, metrics, evidence, assertions, 'blocked', 'JOURNEY_OBSERVATION_BUDGET_EXCEEDED');
        if (metrics.statesObserved >= this.policy.maxJourneyStates) return this.finish(journey, metrics, evidence, assertions, 'blocked', 'JOURNEY_STATE_BUDGET_EXCEEDED');
        if (metrics.actions >= this.policy.maxActionsPerTest) return this.finish(journey, metrics, evidence, assertions, 'blocked', 'JOURNEY_ACTION_BUDGET_EXCEEDED');
        metrics.journeyDecisions++;
        const observation = await observeBrowser(page);
        metrics.observations++;
        const state = summarizeObservationState(observation);
        const changed = state.key !== previousStateKey || state.url !== journey.currentState.url || state.visibleTextSummary !== journey.currentState.visibleTextSummary;
        if (!changed) journey.noProgressIterations++;
        else journey.noProgressIterations = 0;
        previousStateKey = state.key;
        recordObservation(journey, state, this.policy.observationHistoryLimit);
        metrics.statesObserved++;
        journey.currentState = state;
        if (activePageId) journey.activePageId = activePageId;
        if (!journey.visitedLocations.some((location) => location.url === state.url && location.stateKey === state.key)) {
          if (journey.visitedLocations.length >= this.policy.maxVisitedPages) return this.finish(journey, metrics, evidence, assertions, 'blocked', 'JOURNEY_PAGE_BUDGET_EXCEEDED');
          journey.visitedLocations.push({ url: state.url, stateKey: state.key, firstSeenObservation: metrics.observations });
        }
        if (journey.noProgressIterations >= this.policy.maxNoProgressIterations) {
          journey.phase = 'blocked';
          return this.finish(journey, metrics, evidence, assertions, 'blocked', 'JOURNEY_NO_PROGRESS');
        }

        if (metrics.agentCalls >= this.policy.maxAgentCalls) return this.finish(journey, metrics, evidence, assertions, 'blocked', 'JOURNEY_AGENT_CALL_BUDGET_EXCEEDED');
        const assertion = await this.tryAssertion(testCase, page, observation, context, metrics, evidence);
        if (assertion) {
          assertions.push(assertion);
          if (assertion.status === 'passed') {
            milestone.status = 'reached';
            milestone.evidenceIds = assertion.evidenceIds;
            journey.completedMilestones.push(milestone);
            journey.pendingMilestones = [];
            journey.phase = 'completed';
            metrics.milestonesReached++;
            return this.finish(journey, metrics, evidence, assertions, 'passed');
          }
        }

        const history = compactJourneyHistory(journey, this.policy.observationHistoryLimit);
        const safeObservation = await redactObservationForAI(observation, testCase, context);
        if (metrics.agentCalls >= this.policy.maxAgentCalls) return this.finish(journey, metrics, evidence, assertions, 'blocked', 'JOURNEY_AGENT_CALL_BUDGET_EXCEEDED');
        let grounding;
        try {
          grounding = await groundStep(this.aiProvider, {
            testCaseId: testCase.id,
            stepIndex: decision,
            stepDescription: `Complete the overall journey goal: ${journey.goal}`,
            stepTarget: `Current semantic state: ${state.key}. Pending milestone: ${milestone.intent}. Runtime binding references: ${journey.runtimeBindings.join(', ') || 'none'}. Recent journey: ${history}`,
            observation: safeObservation,
          });
        } catch (error) {
          const classification = classifyRuntimeFailure(error instanceof Error ? error.message : String(error));
          metrics.failuresDetected++;
          metrics.recoveryAttempts++;
          const recovery = decideRecovery(classification, metrics.recoveryAttempts, this.policy.maxRecoveryAttempts);
          appendRecovery(journey, { classification, operation: recovery.operation, attempt: metrics.recoveryAttempts, stateBefore: state.key, outcome: recovery.allowed ? 'SUCCESS' : 'BLOCKED', evidenceIds: [] });
          if (recovery.allowed) {
            metrics.successfulRecoveries++;
            metrics.invalidDecisionRecoveries++;
            metrics.recoveries++;
            await boundedWait(50);
            continue;
          }
          metrics.failedRecoveries++;
          return this.finish(journey, metrics, evidence, assertions, 'blocked', 'JOURNEY_RECOVERY_BLOCKED', recovery.reason);
        }
        metrics.agentCalls++;
        const journeyDecision: JourneyDecision = grounding.action
          ? { type: 'ACTION', subGoal: milestone.intent, targetIntent: state.key, reasoningSummary: grounding.reasoning }
          : { type: 'BLOCKED', reason: grounding.unresolvedReason ?? 'JOURNEY_NO_GROUNDED_ACTION' };
        if (journeyDecision.type === 'BLOCKED') {
          if (isLoadingObservation(observation) && journey.recoveryAttempts < this.policy.maxJourneyRecoveries) {
            journey.recoveryAttempts++;
            metrics.recoveries++;
            await boundedWait(100);
            continue;
          }
          if (assertion?.status !== 'failed' && journey.actionHistory.length > 0 && journey.recoveryAttempts < this.policy.maxJourneyRecoveries && page.goBack) {
            const recovery = await page.goBack();
            journey.recoveryAttempts++;
            metrics.recoveries++;
            journey.actionHistory.push({
              decision,
              stateKey: state.key,
              actionType: 'goBack',
              urlBefore: observation.url,
              urlAfter: recovery.url ?? page.url(),
              success: recovery.success,
              error: recovery.error,
            });
            if (recovery.success) {
              await boundedWait(50);
              continue;
            }
          }
          journey.phase = journey.actionHistory.length > 0 && assertion?.status === 'failed' ? 'failed' : 'blocked';
          return this.finish(journey, metrics, evidence, assertions, journey.phase === 'failed' ? 'failed' : 'blocked', journeyDecision.reason);
        }
        const idMap = ElementIdMap.fromObservation(observation);
        const resolvedAction = await resolveActionValue(grounding.action!, undefined, context, coordination.runtimeData);
        if (!resolvedAction.action) {
          journey.phase = 'blocked';
          return this.finish(journey, metrics, evidence, assertions, 'blocked', resolvedAction.error ?? 'JOURNEY_BINDING_RESOLUTION_FAILED');
        }
        const validation = validateAction(resolvedAction.action, observation, this.policy, {
          navigationActions: metrics.navigationActions,
          totalActions: metrics.actions,
        });
        if (!validation.valid) {
          metrics.replans++;
          metrics.journeyReplans++;
          if (metrics.journeyReplans > this.policy.maxJourneyReplans) return this.finish(journey, metrics, evidence, assertions, 'blocked', validation.reason ?? 'JOURNEY_REPLAN_BUDGET_EXCEEDED');
          continue;
        }
        const beforeUrl = observation.url;
        const actionResult = await executeAction(page, resolvedAction.action, idMap);
        metrics.actions++;
        await boundedWait(100);
        if (resolvedAction.action.type === 'navigate') metrics.navigationActions++;
        const actionKey = `${state.key}|${resolvedAction.action.type}|${resolvedAction.action.elementId ?? resolvedAction.action.url ?? ''}`;
        const repetitions = (seenDecisions.get(actionKey) ?? 0) + 1;
        seenDecisions.set(actionKey, repetitions);
        if (repetitions >= 3) {
          journey.loopDetections++;
          metrics.loopDetections++;
          journey.phase = 'blocked';
          return this.finish(journey, metrics, evidence, assertions, 'blocked', 'JOURNEY_LOOP_DETECTED');
        }
        journey.actionHistory.push({
          decision,
          stateKey: state.key,
          actionType: resolvedAction.action.type,
          elementId: resolvedAction.action.elementId,
          urlBefore: beforeUrl,
          urlAfter: page.url(),
          success: actionResult.success,
          error: actionResult.error,
        });
        const pageTransition = await this.handleNewPageTransition(knownPageIds, journey, metrics);
        if (pageTransition.status === 'blocked') return this.finish(journey, metrics, evidence, assertions, 'blocked', pageTransition.error);
        if (pageTransition.context) {
          page = pageTransition.context.page;
          activePageId = pageTransition.context.id;
          const refreshed = await this.browserSession.pageContexts?.() ?? [];
          knownPageIds = new Set(refreshed.map((candidate) => candidate.id));
          journey.activePageId = activePageId;
          journey.pageContexts = refreshed.map(toJourneyPageContext);
          await boundedWait(50);
        }
        if (!actionResult.success) {
          const classification = classifyRuntimeFailure(actionResult.error ?? 'Action failed', resolvedAction.action.type);
          metrics.failuresDetected++;
          metrics.recoveryAttempts++;
          const recovery = decideRecovery(classification, metrics.recoveryAttempts, this.policy.maxRecoveryAttempts);
          appendRecovery(journey, { classification, operation: recovery.operation, attempt: metrics.recoveryAttempts, stateBefore: state.key, outcome: recovery.allowed ? 'SUCCESS' : 'BLOCKED', evidenceIds: [] });
          if (!recovery.allowed) {
            metrics.failedRecoveries++;
            return this.finish(journey, metrics, evidence, assertions, classification === 'CONTEXT_LOST' ? 'error' : 'blocked', 'JOURNEY_RECOVERY_BLOCKED', recovery.reason);
          }
          metrics.successfulRecoveries++;
          metrics.recoveries++;
          await boundedWait(50);
        }
        metrics.evidenceCount = evidence.length;
      }
      journey.phase = 'blocked';
      return this.finish(journey, metrics, evidence, assertions, 'blocked', 'JOURNEY_DECISION_BUDGET_EXCEEDED');
    } catch (error) {
      journey.phase = 'error';
      return this.finish(journey, metrics, evidence, assertions, 'error', 'JOURNEY_BROWSER_ERROR', error instanceof Error ? error.message : String(error));
    }
  }

  async cleanup(): Promise<{ status: 'succeeded' | 'failed'; error?: { code: string; message: string } }> {
    if (this.cleaned) return this.lastCleanup ?? { status: 'succeeded' };
    this.cleaned = true;
    try {
      await this.browserSession.close();
      await this.dataNeedCoordinator.cleanup();
      this.lastCleanup = { status: 'succeeded' };
    } catch (error) {
      this.lastCleanup = { status: 'failed', error: { code: 'JOURNEY_CLEANUP_FAILED', message: error instanceof Error ? error.message : String(error) } };
    }
    return this.lastCleanup;
  }

  private async handleNewPageTransition(
    knownPageIds: Set<string>,
    journey: JourneyState,
    metrics: ReturnType<typeof createJourneyMetrics>,
  ): Promise<{ status: 'ok' | 'blocked'; context?: BrowserPageContext; error?: string }> {
    if (!this.browserSession.pageContexts) return { status: 'ok' };
    const contexts = await this.browserSession.pageContexts();
    const created = contexts.filter((candidate) => !knownPageIds.has(candidate.id));
    if (created.length === 0) return { status: 'ok' };
    const allowed = created.filter((candidate) => this.isAllowedOrigin(candidate.url));
    if (created.length !== 1 || allowed.length !== 1) {
      for (const candidate of created) if (this.browserSession.closePage) await this.browserSession.closePage(candidate.id);
      return { status: 'blocked', error: created.length > 1 ? 'JOURNEY_AMBIGUOUS_POPUP' : 'JOURNEY_EXTERNAL_POPUP_DENIED' };
    }
    const context = this.browserSession.activatePage ? await this.browserSession.activatePage(allowed[0].id) : allowed[0];
    metrics.popupTransitions++;
    journey.pageContexts = contexts.map(toJourneyPageContext).map((entry) => ({ ...entry, active: entry.id === context.id }));
    return { status: 'ok', context };
  }

  private isAllowedOrigin(url: string): boolean {
    try { return this.allowedOrigins.includes(new URL(url).origin); } catch { return false; }
  }

  private async tryAssertion(
    testCase: TestCase,
    page: BrowserPage,
    observation: BrowserObservation,
    context: TestExecutionContext,
    metrics: ReturnType<typeof createJourneyMetrics>,
    evidence: EvidenceReference[],
  ): Promise<AgenticAssertionResult | undefined> {
    if (testCase.expectedResults.length === 0 || metrics.actions === 0) return undefined;
    const expected = testCase.expectedResults[0];
    const grounding = await groundAssertion(this.aiProvider, {
      testCaseId: testCase.id,
      expectedResultIndex: 0,
      expectedDescription: expected.description,
      verificationType: expected.verificationType,
      observation: await redactObservationForAI(observation, testCase, context),
    });
    metrics.agentCalls++;
    metrics.assertions++;
    if (grounding.unresolvedReason) return { expectedResultIndex: 0, description: expected.description, grounding, status: 'blocked', evidenceIds: [] };
    const status = verifyJourneyAssertion(observation, grounding);
    const ev = addTextEvidence(context, {
      type: 'text', sourceExecutor: 'ui', testCaseId: testCase.id, assertionId: 'ASSERT-0001',
      metadata: { kind: 'journey-assertion-observation', status, state: summarizeObservationState(observation).key }, sensitive: false,
    });
    if (ev) evidence.push(ev);
    metrics.evidenceCount = evidence.length;
    return { expectedResultIndex: 0, description: expected.description, grounding, status, evidenceIds: ev ? [ev.id] : [] };
  }

  private finish(
    journey: JourneyState,
    metrics: ReturnType<typeof createJourneyMetrics>,
    evidence: EvidenceReference[],
    assertions: AgenticAssertionResult[],
    status: 'passed' | 'failed' | 'blocked' | 'error',
    code?: string,
    message?: string,
  ): JourneyExecutionResult {
    journey.phase = status === 'passed' ? 'completed' : status;
    metrics.uniqueSemanticStates = new Set(journey.observationHistory.map((entry) => entry.state.key)).size;
    metrics.milestonesPlanned = journey.completedMilestones.length + journey.pendingMilestones.length;
    metrics.milestonesReached = journey.completedMilestones.length;
    metrics.pageTransitions = new Set(journey.visitedLocations.map((location) => location.url)).size - 1;
    metrics.dialogTransitions = journey.observationHistory.filter((entry, index, all) => index > 0 && entry.state.dialogPresent !== all[index - 1].state.dialogPresent).length;
    metrics.noProgressIterations = journey.noProgressIterations;
    metrics.evidenceCount = evidence.length;
    metrics.maxSimultaneousPages = journey.pageContexts.length;
    return { testCaseId: journey.testCaseId, status, journey, assertions, evidence, metrics, ...(code ? { error: { code, message: message ?? code } } : {}) };
  }
}

function isLoadingObservation(observation: BrowserObservation): boolean {
  return /\b(loading|please wait|in progress|skeleton|spinner)\b/i.test(
    `${observation.title} ${observation.headings.join(' ')} ${observation.pageText}`,
  );
}

async function boundedWait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, Math.min(milliseconds, 250)));
}

function recordObservation(journey: JourneyState, state: SemanticApplicationState, limit: number): void {
  journey.observationHistory.push({ index: journey.observationHistory.length + 1, state });
  if (journey.observationHistory.length > limit) journey.observationHistory.shift();
}

function emptySemanticState(baseUrl: string): SemanticApplicationState {
  return { key: 'planning:root', url: baseUrl, title: '', headings: [], visibleTextSummary: '', dialogPresent: false };
}

function verifyJourneyAssertion(
  observation: BrowserObservation,
  grounding: Awaited<ReturnType<typeof groundAssertion>>,
): 'passed' | 'failed' | 'blocked' {
  const text = `${observation.pageText} ${observation.headings.join(' ')}`.toLowerCase();
  switch (grounding.assertionType) {
    case 'text-visible': return grounding.expectedValue ? text.includes(grounding.expectedValue.toLowerCase()) ? 'passed' : 'failed' : 'blocked';
    case 'title-contains': return grounding.expectedValue ? observation.title.toLowerCase().includes(grounding.expectedValue.toLowerCase()) ? 'passed' : 'failed' : 'blocked';
    case 'url-contains': return grounding.expectedValue ? observation.url.includes(grounding.expectedValue) ? 'passed' : 'failed' : 'blocked';
    case 'url-equals': return grounding.expectedValue ? observation.url === grounding.expectedValue ? 'passed' : 'failed' : 'blocked';
    case 'element-visible': return grounding.elementId && observation.elements.some((element) => element.id === grounding.elementId) ? 'passed' : 'failed';
    case 'element-absent': return !grounding.elementId || !observation.elements.some((element) => element.id === grounding.elementId) ? 'passed' : 'failed';
    default: return 'blocked';
  }
}

function createJourneyMetrics(): JourneyExecutionResult['metrics'] {
  return {
    agentCalls: 0, observations: 0, actions: 0, replans: 0, groundingFailures: 0,
    navigationActions: 0, assertions: 0, evidenceCount: 0, journeyDecisions: 0,
    statesObserved: 0, uniqueSemanticStates: 0, milestonesPlanned: 1, milestonesReached: 0,
    journeyReplans: 0, recoveries: 0, loopDetections: 0, noProgressIterations: 0,
    pageTransitions: 0, dialogTransitions: 0, popupTransitions: 0, maxSimultaneousPages: 1,
    failuresDetected: 0, successfulRecoveries: 0, failedRecoveries: 0, recoveryLoopsDetected: 0,
    recoveryAttempts: 0, invalidDecisionRecoveries: 0,
  };
}

function toJourneyPageContext(context: BrowserPageContext): JourneyPageContext {
  return { id: context.id, url: context.url, openerPageId: context.openerPageId, active: context.active };
}

function appendRecovery(journey: JourneyState, event: JourneyState['recoveryHistory'][number]): void {
  journey.recoveryHistory.push(event);
  if (journey.recoveryHistory.length > 8) journey.recoveryHistory.shift();
}
