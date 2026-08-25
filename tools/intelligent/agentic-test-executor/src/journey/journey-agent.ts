import type { AIProvider } from 'ai-provider';
import type { BrowserPage, BrowserPageContext, BrowserSession } from 'ui-executor';
import type {
  TestCase,
  TestExecutionContext,
  EvidenceReference,
} from 'test-execution-orchestrator';
import { defaultCapabilities, type AgenticAssertionResult, type BrowserObservation, type TestDataItem, type StepGroundingResult } from '../models.js';
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
import { classifyRuntimeFailure, decideRecovery, type RecoveryReconciliationAdapter } from './recovery.js';
import { verifyCrossLayer, type VerificationReport, type VerificationRuntime } from '../verification.js';
import { confirmSourceHints, groundConfirmedAction, resolveRelevantSourceHints, type SourceHint, type SourceIntelligence, type SourceIntelligenceProvider } from '../source-intelligence.js';

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
  reconciliationAdapter?: RecoveryReconciliationAdapter;
  verification?: VerificationRuntime;
  sourceIntelligence?: SourceIntelligence | SourceIntelligenceProvider;
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
  private readonly reconciliationAdapter?: RecoveryReconciliationAdapter;
  private readonly reconciledCleanup: Array<() => Promise<void>> = [];
  private readonly verification?: VerificationRuntime;
  private readonly sourceIntelligence?: SourceIntelligence | SourceIntelligenceProvider;
  private verificationReport?: VerificationReport;

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
    this.reconciliationAdapter = options.reconciliationAdapter;
    this.verification = options.verification;
    this.sourceIntelligence = options.sourceIntelligence;
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

    let sourceSnapshot: SourceIntelligence | undefined;
    if (this.sourceIntelligence) {
      try {
        sourceSnapshot = 'discover' in this.sourceIntelligence
          ? await this.sourceIntelligence.discover({ testCase })
          : this.sourceIntelligence;
        metrics.sourceHintsAvailable = sourceSnapshot.hints.length;
      } catch {
        metrics.sourceProviderFailures++;
      }
    }

    let page: BrowserPage;
    let activePageId: string | undefined;
    let knownPageIds = new Set<string>();
    let reauthenticating = false;
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
        const pageRecovery = await this.recoverLostPage(activePageId, journey, metrics);
        if (pageRecovery.status === 'error') return this.finish(journey, metrics, evidence, assertions, 'error', 'JOURNEY_CONTEXT_LOST', pageRecovery.reason);
        if (pageRecovery.status === 'blocked') return this.finish(journey, metrics, evidence, assertions, 'blocked', 'JOURNEY_PAGE_RECOVERY_BLOCKED', pageRecovery.reason);
        if (pageRecovery.context) {
          page = pageRecovery.context.page;
          activePageId = pageRecovery.context.id;
          knownPageIds = new Set((await this.browserSession.pageContexts?.() ?? []).map((candidate) => candidate.id));
        }
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
        let sourceHints: SourceHint[] = [];
        let confirmedSourceHints: SourceHint[] = [];
        if (sourceSnapshot) {
          const relevant = resolveRelevantSourceHints(sourceSnapshot, testCase, state.key);
          const reconciled = confirmSourceHints(relevant.provided, observation);
          sourceHints = relevant.provided;
          confirmedSourceHints = reconciled.confirmed;
          metrics.sourceHintsProvided += sourceHints.length;
          metrics.sourceHintsConfirmed += reconciled.confirmed.length;
          metrics.sourceHintsRejected += reconciled.rejected.length;
          metrics.sourceHintsStale += reconciled.stale.length;
        }
        const sessionLost = journey.actionHistory.length > 0 && isAuthenticationState(observation);
        if (sessionLost && !reauthenticating) {
          metrics.failuresDetected++;
          const credentialAvailable = context.bindings.sensitiveNames().size > 0;
          if (!credentialAvailable || metrics.reauthAttempts >= this.policy.maxReauthAttempts) {
            appendRecovery(journey, { classification: 'SESSION_LOST', operation: 'REAUTHENTICATE', attempt: metrics.reauthAttempts + 1, stateBefore: state.key, outcome: 'BLOCKED', evidenceIds: [] });
            return this.finish(journey, metrics, evidence, assertions, 'blocked', 'JOURNEY_SESSION_RECOVERY_BLOCKED', 'Protected credential binding is unavailable or reauthentication budget is exhausted.');
          }
          metrics.reauthAttempts++;
          metrics.sessionRecoveries++;
          metrics.recoveries++;
          reauthenticating = true;
          appendRecovery(journey, { classification: 'SESSION_LOST', operation: 'REAUTHENTICATE', attempt: metrics.reauthAttempts, stateBefore: state.key, outcome: 'SUCCESS', evidenceIds: [] });
        } else if (reauthenticating && !sessionLost) {
          reauthenticating = false;
        }
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
            if (this.verification) {
              this.verificationReport = await verifyCrossLayer(testCase, this.verification, context.bindings, observation);
              metrics.verificationAcquisitions += this.verificationReport.acquisitions;
              metrics.verificationAICalls += this.verificationReport.verificationAICalls;
              for (const item of this.verificationReport.evidence) {
                const evidenceRef = context.evidence.add({
                  type: item.source === 'UI' ? 'text' : item.source === 'API' ? 'api-response' : 'database-result',
                  sourceExecutor: item.source === 'UI' ? 'ui' : item.source === 'API' ? 'api' : 'database',
                  testCaseId: testCase.id,
                  assertionId: 'ASSERT-0001',
                  metadata: { verificationEvidenceId: item.id, source: item.source, entityKey: item.entityKey, property: item.property, normalizedValue: item.normalizedValue, provenance: item.provenance },
                  sensitive: false,
                });
                evidence.push(evidenceRef);
                assertion.evidenceIds.push(evidenceRef.id);
              }
              if (this.verificationReport.status !== 'VERIFIED') {
                assertion.status = this.verificationReport.status === 'CONTRADICTED' ? 'failed' : 'blocked';
                const terminal = this.verificationReport.status === 'ACQUISITION_ERROR' ? 'error' : assertion.status;
                return this.finish(journey, metrics, evidence, assertions, terminal, `VERIFICATION_${this.verificationReport.status}`, this.verificationReport.explanation);
              }
            }
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
        let grounding: StepGroundingResult;
        const sourceAction = groundConfirmedAction(confirmedSourceHints, observation);
        try {
          if (sourceAction) {
            metrics.sourceHintsUsed++;
            grounding = {
              testCaseId: testCase.id, stepIndex: decision, stepIntent: milestone.intent,
              action: { type: 'click', elementId: sourceAction.elementId }, candidateActions: [], confidence: 'high',
              reasoning: `Runtime-confirmed semantic source hint: ${sourceAction.hint.semanticName}`,
            };
          } else {
            grounding = await groundStep(this.aiProvider, {
              testCaseId: testCase.id,
              stepIndex: decision,
              stepDescription: `Complete the overall journey goal: ${journey.goal}`,
              stepTarget: `Current semantic state: ${state.key}. Pending milestone: ${milestone.intent}. Runtime binding references: ${journey.runtimeBindings.join(', ') || 'none'}. credentialBindingAvailable=${context.bindings.sensitiveNames().size > 0}. Source hints: ${sourceHints.map((hint) => `${hint.kind}:${hint.semanticName}`).join(', ') || 'none'}. Recent journey: ${history}`,
              observation: safeObservation,
            });
          }
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
        if (!sourceAction) metrics.agentCalls++;
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
          if (classification === 'AMBIGUOUS_OUTCOME' && this.reconciliationAdapter) {
            try {
              const reconciled = await this.reconciliationAdapter({
                operationId: `${testCase.id}-${decision}`,
                actionType: resolvedAction.action.type,
                error: actionResult.error ?? 'Action failed',
                stateKey: state.key,
                bindingReferences: journey.runtimeBindings,
              });
              if (reconciled.status === 'RECONCILED_SUCCESS' && reconciled.binding && reconciled.ownership === 'TEST_OWNED' && reconciled.journalRef && reconciled.cleanup) {
                context.bindings.produce(reconciled.binding);
                this.reconciledCleanup.push(reconciled.cleanup);
                metrics.outcomeReconciliations++;
                appendRecovery(journey, { classification, operation: 'RECONCILE_OUTCOME', attempt: metrics.recoveryAttempts, stateBefore: state.key, outcome: 'SUCCESS', evidenceIds: [] });
                await boundedWait(50);
                continue;
              }
              if (reconciled.status === 'RECONCILED_NOT_EXECUTED') {
                metrics.outcomeReconciliations++;
                appendRecovery(journey, { classification, operation: 'RECONCILE_OUTCOME', attempt: metrics.recoveryAttempts, stateBefore: state.key, outcome: 'SUCCESS', evidenceIds: [] });
                await boundedWait(50);
                continue;
              }
              if (reconciled.status === 'RECONCILIATION_ERROR') return this.finish(journey, metrics, evidence, assertions, 'error', 'JOURNEY_RECONCILIATION_ERROR', reconciled.reason);
            } catch (error) {
              return this.finish(journey, metrics, evidence, assertions, 'error', 'JOURNEY_RECONCILIATION_ERROR', error instanceof Error ? error.message : String(error));
            }
          }
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
      for (const cleanup of this.reconciledCleanup.splice(0)) await cleanup();
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

  private async recoverLostPage(activePageId: string | undefined, journey: JourneyState, metrics: ReturnType<typeof createJourneyMetrics>): Promise<{ status: 'ok' | 'blocked' | 'error'; context?: BrowserPageContext; reason?: string }> {
    if (!activePageId || !this.browserSession.pageContexts) return { status: 'ok' };
    const contexts = await this.browserSession.pageContexts();
    if (contexts.some((candidate) => candidate.id === activePageId)) return { status: 'ok' };
    const lost = journey.pageContexts.find((candidate) => candidate.id === activePageId);
    const allowed = contexts.filter((candidate) => this.isAllowedOrigin(candidate.url));
    const opener = lost?.openerPageId ? allowed.filter((candidate) => candidate.id === lost.openerPageId) : [];
    const selected = opener.length === 1 ? opener : allowed.length === 1 ? allowed : [];
    metrics.failuresDetected++;
    metrics.recoveryAttempts++;
    if (selected.length !== 1 || metrics.pageRecoveries >= this.policy.maxPageRecoveryAttempts) {
      metrics.failedRecoveries++;
      appendRecovery(journey, { classification: allowed.length === 0 ? 'CONTEXT_LOST' : 'PAGE_LOST', operation: 'REOPEN_CONTEXT', attempt: metrics.recoveryAttempts, stateBefore: journey.currentState.key, outcome: 'BLOCKED', evidenceIds: [] });
      return { status: allowed.length === 0 ? 'error' : 'blocked', reason: allowed.length === 0 ? 'No trusted browser page remains.' : 'Page recovery candidates are ambiguous.' };
    }
    const context = this.browserSession.activatePage ? await this.browserSession.activatePage(selected[0].id) : selected[0];
    metrics.pageRecoveries++;
    metrics.successfulRecoveries++;
    appendRecovery(journey, { classification: 'PAGE_LOST', operation: 'REOPEN_CONTEXT', attempt: metrics.recoveryAttempts, stateBefore: journey.currentState.key, stateAfter: context.url, outcome: 'SUCCESS', evidenceIds: [] });
    return { status: 'ok', context };
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
    return { testCaseId: journey.testCaseId, status, journey, assertions, evidence, metrics, ...(this.verificationReport ? { verification: this.verificationReport } : {}), ...(code ? { error: { code, message: message ?? code } } : {}) };
  }
}

function isLoadingObservation(observation: BrowserObservation): boolean {
  return /\b(loading|please wait|in progress|skeleton|spinner)\b/i.test(
    `${observation.title} ${observation.headings.join(' ')} ${observation.pageText}`,
  );
}

function isAuthenticationState(observation: BrowserObservation): boolean {
  return /\b(login|log in|sign in|authentication|session expired|unauthorized)\b/i.test(
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
    recoveryAttempts: 0, invalidDecisionRecoveries: 0, sessionRecoveries: 0, reauthAttempts: 0,
    pageRecoveries: 0, outcomeReconciliations: 0, verificationAcquisitions: 0, verificationAICalls: 0,
    sourceHintsAvailable: 0, sourceHintsProvided: 0, sourceHintsUsed: 0, sourceHintsConfirmed: 0, sourceHintsRejected: 0, sourceHintsStale: 0, sourceProviderFailures: 0,
  };
}

function toJourneyPageContext(context: BrowserPageContext): JourneyPageContext {
  return { id: context.id, url: context.url, openerPageId: context.openerPageId, active: context.active };
}

function appendRecovery(journey: JourneyState, event: JourneyState['recoveryHistory'][number]): void {
  journey.recoveryHistory.push(event);
  if (journey.recoveryHistory.length > 8) journey.recoveryHistory.shift();
}
