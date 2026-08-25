// ---------------------------------------------------------------------------
// Agentic Test Executor — public API
// ---------------------------------------------------------------------------

export { AgenticTestExecutor, addTextEvidence, redactObservationForAI, resolveActionValue } from './agent.js';
export type { AgenticTestExecutorOptions } from './agent.js';
export { JourneyAgent } from './journey/journey-agent.js';
export { JourneyTestExecutor } from './journey/journey-test-executor.js';
export type { JourneyAgentOptions as JourneyTestExecutorOptions } from './journey/journey-agent.js';
export type {
  JourneyAgentOptions,
} from './journey/journey-agent.js';

export type {
  SemanticApplicationState,
  JourneyMilestone,
  JourneyActionRecord,
  JourneyObservationSummary,
  JourneyLocation,
  JourneyPageContext,
  JourneyState,
  JourneyExecutionPolicy,
  JourneyExecutionResult,
  JourneyDecision,
} from './journey/models.js';
export { defaultJourneyPolicy, summarizeObservationState, compactJourneyHistory } from './journey/models.js';
export { classifyRuntimeFailure, decideRecovery } from './journey/recovery.js';
export type { FailureClassification, RecoveryOperation, RecoveryDecision, RecoveryEvent, ReconciliationStatus, ReconciliationResult, ReconciliationRequest, RecoveryReconciliationAdapter } from './journey/recovery.js';

export type {
  AgentCapabilities,
  CapabilityStatus,
  AgenticActionType,
  AgenticAction,
  BrowserObservation,
  ObservedElement,
  StepGroundingRequest,
  StepGroundingResult,
  AssertionGroundingRequest,
  AssertionGroundingResult,
  AgenticAssertionType,
  AgentExecutionPolicy,
  AgentMode,
  AgenticTestExecutionRequest,
  AgenticExecutionResult,
  AgenticStepResult,
  AgenticAssertionResult,
  AgentMetrics,
  DataNeedStatus,
  DataNeedSemantics,
  DataResolutionSource,
  DataResolutionResult,
  DataResolutionPreparation,
  DataResolutionEvidence,
  DataResolutionMetrics,
  AgenticFailureCode,
  AgentCheckpoint,
  ConfidenceClass,
  CandidateAction,
} from './models.js';

export { defaultCapabilities, defaultAgentPolicy } from './models.js';

export { AgenticExecutorError, isAgenticError } from './errors.js';

export { validateCapabilities, isCapabilityAvailable } from './capability/capability-model.js';

export { observeBrowser } from './observation/browser-observer.js';
export { ElementIdMap } from './observation/element-id-map.js';
export { normalizeBaseUrl } from './runtime/base-url.js';
export { runRealAppPreflight } from './real-app/preflight.js';
export type { RealAppPreflightInput, RealAppPreflightResult, RealAppPreflightStatus } from './real-app/preflight.js';

export { groundStep } from './grounding/step-grounding.js';
export { groundAssertion } from './assertion/assertion-grounding.js';

export { validateAction } from './action/action-validator.js';
export { executeAction } from './action/action-executor.js';

export {
  classifyDataNeed,
  resolveDataItem,
  resolveDataItems,
} from './data/data-resolver.js';
export type {
  DataResolutionContext,
  DataResolutionExecutionContext,
} from './data/data-resolver.js';

export {
  DataNeedCoordinator,
  DataNeedCoordinatorError,
} from './data/data-need-coordinator.js';
export type {
  DataNeedCoordinatorContext,
  DataNeedCoordinatorOptions,
  DataNeedCoordinationResult,
} from './data/data-need-coordinator.js';

export {
  buildPlanningEnvironment,
  buildRuntimeCapabilityInventory,
} from './data/runtime-capability-inventory.js';
export type {
  RuntimeCapabilityInventory,
  RuntimeCapabilityInventoryOverrides,
  RuntimeBrowserCapability,
  RuntimeDatabaseCapability,
  RuntimeApiCapability,
  RuntimeSecretCapability,
  RuntimeSourceCapability,
  RuntimeFileCapability,
  RuntimeDiscoveryAdapter,
  RuntimeDiscoveryRequest,
  RuntimeDiscoveryResult,
  RuntimePreparationRequest,
  RuntimePreparationResult,
  RuntimePreparationAdapter,
  RuntimeSnapshotResult,
  RuntimeCleanupRequest,
} from './data/runtime-capability-inventory.js';

export { RuntimeDataStore } from './data/runtime-data-store.js';
export type { RuntimeDataBinding, SafeRuntimeDataBinding } from './data/runtime-data-store.js';
export { RuntimePreparationExecutor, RuntimePreparationError } from './data/preparation-executor.js';
export {
  PreparationJournal,
  RuntimePreparationCoordinator,
  defaultPreparationMutationPolicy,
  evaluatePreparationPolicy,
  resolveEnvironmentKind,
} from './data/preparation-lifecycle.js';
export type {
  PreparationEnvironment,
  PreparationExecutorKind,
  PreparationMutationPolicy,
  PreparationMutationAction,
  PreparationStrategy,
  PreparedResourceOwnership,
  PreparationPolicyDecision,
  PreparationJournalEntry,
  SafePreparationJournalEntry,
  PreparationProof,
  PreparationCleanupSummary,
  PreparationCoordinationInput,
  PreparationCoordinationResult,
} from './data/preparation-lifecycle.js';
