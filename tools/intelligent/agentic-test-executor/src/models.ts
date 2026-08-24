// ---------------------------------------------------------------------------
// Agentic Test Executor — models
// ---------------------------------------------------------------------------

import type {
  TestCase,
  TestStep,
  ExpectedResult,
  TestResultStatus,
  EvidenceReference,
} from 'test-execution-orchestrator';

import type { TestDataItem } from 'test-data-planner';

// Re-export upstream types used by consumers.
export type {
  TestCase,
  TestStep,
  ExpectedResult,
  TestDataItem,
};

// ---- Capability Model (§7) ------------------------------------------------

export type CapabilityStatus = 'AVAILABLE' | 'UNAVAILABLE';

export interface AgentCapabilities {
  browser: CapabilityStatus;
  database: CapabilityStatus;
  api: CapabilityStatus;
  source: CapabilityStatus;
  secrets: CapabilityStatus;
  files: CapabilityStatus;
}

export function defaultCapabilities(): AgentCapabilities {
  return {
    browser: 'UNAVAILABLE',
    database: 'UNAVAILABLE',
    api: 'UNAVAILABLE',
    source: 'UNAVAILABLE',
    secrets: 'UNAVAILABLE',
    files: 'UNAVAILABLE',
  };
}

// ---- Canonical Actions (§14) ----------------------------------------------

export type AgenticActionType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'press'
  | 'wait-for'
  | 'observe';

export interface AgenticAction {
  type: AgenticActionType;
  elementId?: string;
  value?: string;
  url?: string;
  key?: string;
}

// ---- Browser Observation (§9, §10) ----------------------------------------

export interface ObservedElement {
  id: string;
  role: string;
  accessibleName?: string;
  label?: string;
  placeholder?: string;
  inputType?: string;
  visibleText?: string;
  enabled: boolean;
  checked?: boolean;
  selected?: boolean;
}

export interface BrowserObservation {
  url: string;
  title: string;
  headings: string[];
  elements: ObservedElement[];
  pageText: string;
  truncated: boolean;
}

// ---- Grounding (§13) ------------------------------------------------------

export type ConfidenceClass = 'high' | 'medium' | 'low';

export interface StepGroundingRequest {
  testCaseId: string;
  stepIndex: number;
  stepDescription: string;
  stepTarget?: string;
  stepInput?: string;
  observation: BrowserObservation;
  previousFailure?: string;
}

export interface StepGroundingResult {
  testCaseId: string;
  stepIndex: number;
  stepIntent: string;
  action?: AgenticAction;
  candidateActions: CandidateAction[];
  confidence: ConfidenceClass;
  reasoning: string;
  unresolvedReason?: string;
}

export interface CandidateAction {
  action: AgenticAction;
  reason: string;
}

// ---- Assertion Grounding (§27, §28) ---------------------------------------

export type AgenticAssertionType =
  | 'text-visible'
  | 'element-visible'
  | 'element-absent'
  | 'url-contains'
  | 'url-equals'
  | 'value-equals'
  | 'title-contains'
  | 'title-equals';

export interface AssertionGroundingRequest {
  testCaseId: string;
  expectedResultIndex: number;
  expectedDescription: string;
  verificationType: string;
  observation: BrowserObservation;
}

export interface AssertionGroundingResult {
  testCaseId: string;
  expectedResultIndex: number;
  assertionType: AgenticAssertionType;
  elementId?: string;
  expectedValue?: string;
  confidence: ConfidenceClass;
  reasoning: string;
  unresolvedReason?: string;
}

// ---- Agent Execution Policy (§18) -----------------------------------------

export interface AgentExecutionPolicy {
  maxActionsPerTest: number;
  maxNavigationActions: number;
  maxReplans: number;
  maxAgentCalls: number;
  maxObservationRounds: number;
}

export function defaultAgentPolicy(): AgentExecutionPolicy {
  return {
    maxActionsPerTest: 50,
    maxNavigationActions: 5,
    maxReplans: 3,
    maxAgentCalls: 20,
    maxObservationRounds: 20,
  };
}

// ---- Agent Execution Request (§6) -----------------------------------------

export type AgentMode = 'black-box' | 'gray-box';

export interface AgenticTestExecutionRequest {
  testCase: TestCase;
  testDataItems?: TestDataItem[];
  runtime: {
    baseUrl: string;
    mode: AgentMode;
  };
  capabilities: AgentCapabilities;
  policy: AgentExecutionPolicy;
  secrets?: Record<string, string>;
  sourceRepository?: string;
}

// ---- Agent Execution Result ------------------------------------------------

export interface AgenticStepResult {
  stepOrder: number;
  intent: string;
  grounding: StepGroundingResult;
  action?: AgenticAction;
  status: 'passed' | 'failed' | 'blocked' | 'skipped';
  replans: number;
  evidenceIds: string[];
  error?: string;
}

export interface AgenticAssertionResult {
  expectedResultIndex: number;
  description: string;
  grounding: AssertionGroundingResult;
  status: 'passed' | 'failed' | 'not-verified' | 'blocked';
  actual?: unknown;
  evidenceIds: string[];
}

export interface AgenticExecutionResult {
  testCaseId: string;
  status: TestResultStatus;
  steps: AgenticStepResult[];
  assertions: AgenticAssertionResult[];
  evidence: EvidenceReference[];
  agentMetrics: AgentMetrics;
  errors: Array<{ code: string; message: string }>;
  warnings: string[];
}

// ---- Agent Metrics (§38) --------------------------------------------------

export interface AgentMetrics {
  agentCalls: number;
  observations: number;
  actions: number;
  replans: number;
  groundingFailures: number;
  navigationActions: number;
  assertions: number;
  evidenceCount: number;
}

// ---- Agent Failure Codes (§56) --------------------------------------------

export type AgenticFailureCode =
  | 'AGENT_GROUNDING_FAILED'
  | 'AGENT_AMBIGUOUS_TARGET'
  | 'AGENT_ACTION_BUDGET_EXCEEDED'
  | 'AGENT_REPLAN_BUDGET_EXCEEDED'
  | 'AGENT_CAPABILITY_MISSING'
  | 'AGENT_DATA_UNRESOLVED'
  | 'AGENT_ASSERTION_UNRESOLVED'
  | 'AGENT_NAVIGATION_BUDGET_EXCEEDED'
  | 'AGENT_OBSERVATION_BUDGET_EXCEEDED'
  | 'AGENT_BROWSER_ERROR'
  | 'AGENT_PROVIDER_ERROR';

// ---- Agent Checkpoint (§40) -----------------------------------------------

export interface AgentCheckpoint {
  testCaseId: string;
  completedSteps: number[];
  currentStepIndex: number;
  resolvedData: Record<string, string>;
  evidenceRefs: string[];
  metrics: AgentMetrics;
}

// ---- Observation Observation Script Result --------------------------------

export interface RawObservationData {
  url: string;
  title: string;
  headings: string[];
  pageText: string;
  elements: Array<{
    tag: string;
    role?: string;
    accessibleName?: string;
    label?: string;
    placeholder?: string;
    inputType?: string;
    visibleText?: string;
    enabled: boolean;
    checked: boolean;
    selected: boolean;
    testId?: string;
  }>;
}
