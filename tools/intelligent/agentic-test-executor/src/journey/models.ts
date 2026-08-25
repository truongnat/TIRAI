import type {
  AgentExecutionPolicy,
  AgenticAction,
  AgenticAssertionResult,
  AgentMetrics,
  BrowserObservation,
} from '../models.js';
import type { EvidenceReference, TestResultStatus } from 'test-execution-orchestrator';

export interface SemanticApplicationState {
  key: string;
  url: string;
  title: string;
  headings: string[];
  visibleTextSummary: string;
  dialogPresent: boolean;
}

export interface JourneyMilestone {
  id: string;
  intent: string;
  status: 'pending' | 'reached' | 'blocked';
  evidenceIds: string[];
}

export interface JourneyActionRecord {
  decision: number;
  stateKey: string;
  actionType: AgenticAction['type'];
  elementId?: string;
  urlBefore: string;
  urlAfter?: string;
  success: boolean;
  error?: string;
}

export interface JourneyObservationSummary {
  index: number;
  state: SemanticApplicationState;
}

export interface JourneyLocation {
  url: string;
  stateKey: string;
  firstSeenObservation: number;
}

export type JourneyDecision =
  | { type: 'ACTION'; subGoal: string; targetIntent: string; reasoningSummary: string }
  | { type: 'MILESTONE_REACHED'; milestoneId: string }
  | { type: 'REPLAN'; reason: string; revisedMilestones: JourneyMilestone[] }
  | { type: 'GOAL_REACHED'; evidenceIntent: string }
  | { type: 'BLOCKED'; reason: string };

export interface JourneyState {
  testCaseId: string;
  goal: string;
  phase: 'planning' | 'executing' | 'verifying' | 'completed' | 'blocked' | 'failed' | 'error';
  currentState: SemanticApplicationState;
  completedMilestones: JourneyMilestone[];
  pendingMilestones: JourneyMilestone[];
  actionHistory: JourneyActionRecord[];
  observationHistory: JourneyObservationSummary[];
  runtimeBindings: string[];
  visitedLocations: JourneyLocation[];
  recoveryAttempts: number;
  loopDetections: number;
  noProgressIterations: number;
}

export interface JourneyExecutionPolicy extends AgentExecutionPolicy {
  maxJourneyDecisions: number;
  maxJourneyStates: number;
  maxJourneyReplans: number;
  maxJourneyRecoveries: number;
  maxVisitedPages: number;
  maxNoProgressIterations: number;
  observationHistoryLimit: number;
}

export function defaultJourneyPolicy(base: AgentExecutionPolicy): JourneyExecutionPolicy {
  return {
    ...base,
    maxJourneyDecisions: 12,
    maxJourneyStates: 20,
    maxJourneyReplans: 3,
    maxJourneyRecoveries: 2,
    maxVisitedPages: 12,
    maxNoProgressIterations: 3,
    observationHistoryLimit: 5,
  };
}

export interface JourneyExecutionResult {
  testCaseId: string;
  status: TestResultStatus;
  journey: JourneyState;
  assertions: AgenticAssertionResult[];
  evidence: EvidenceReference[];
  metrics: AgentMetrics & {
    journeyDecisions: number;
    statesObserved: number;
    uniqueSemanticStates: number;
    milestonesPlanned: number;
    milestonesReached: number;
    journeyReplans: number;
    recoveries: number;
    loopDetections: number;
    noProgressIterations: number;
    pageTransitions: number;
    dialogTransitions: number;
  };
  error?: { code: string; message: string };
}

export function summarizeObservationState(observation: BrowserObservation): SemanticApplicationState {
  const path = (() => {
    try {
      const parsed = new URL(observation.url);
      return parsed.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).slice(-1)[0] ?? 'root';
    } catch {
      return 'unknown';
    }
  })();
  const title = observation.title.trim();
  const heading = observation.headings[0]?.trim() ?? '';
  const semanticLabel = (heading || title || path).toLowerCase().replace(/\s+/g, ' ').slice(0, 100);
  const visibleTextSummary = observation.pageText.replace(/\s+/g, ' ').trim().slice(0, 240);
  const dialogPresent = observation.elements.some((element) => element.role.toLowerCase() === 'dialog') ||
    /\b(confirm|confirmation|dialog|modal)\b/i.test(`${title} ${heading} ${visibleTextSummary}`);
  return {
    key: `${semanticLabel}:${path}${dialogPresent ? ':dialog' : ''}`,
    url: observation.url,
    title,
    headings: observation.headings.slice(0, 3),
    visibleTextSummary,
    dialogPresent,
  };
}

export function compactJourneyHistory(state: JourneyState, limit: number): string {
  return state.observationHistory.slice(-limit).map((entry) =>
    `${entry.index}. ${entry.state.key} at ${entry.state.url}`,
  ).join(' -> ');
}
