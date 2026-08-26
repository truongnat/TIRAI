// ---------------------------------------------------------------------------
// Evidence Freshness Models — Freshness dimensions and reuse decisions
// ---------------------------------------------------------------------------
// Defines the freshness model for evidence reuse decisions.

// ---- Freshness Dimensions -------------------------------------------------

export type FreshnessDimension =
  | 'spec'
  | 'requirement'
  | 'testcase'
  | 'expected-result'
  | 'application'
  | 'environment'
  | 'data'
  | 'verification-policy'
  | 'capability'
  | 'time';

export type FreshnessMatch = 'match' | 'mismatch' | 'unknown' | 'not-applicable';

// ---- Evidence Validity Context --------------------------------------------

export interface EvidenceValidityContext {
  /** Schema version. */
  schemaVersion: '1.0';
  /** Evidence ID. */
  evidenceId: string;
  /** TestCase ID. */
  testCaseId: string;
  /** Source revision fingerprint. */
  sourceRevisionFingerprint?: string;
  /** Requirement content hash. */
  requirementContentHash?: string;
  /** TestCase content hash. */
  testCaseContentHash?: string;
  /** ExpectedResult content hash. */
  expectedResultContentHash?: string;
  /** Application identity. */
  application?: ApplicationIdentity;
  /** Environment identity. */
  environment?: EnvironmentIdentity;
  /** Runtime data identity. */
  data?: RuntimeDataIdentity;
  /** Verification policy identity. */
  verificationPolicy?: VerificationPolicyIdentity;
  /** Capability set. */
  capabilities?: CapabilitySet;
  /** Timestamp when evidence was acquired. */
  acquiredAt: string;
  /** Evidence validity window (optional). */
  validUntil?: string;
  /** Reuse policy version. */
  reusePolicyVersion: string;
}

// ---- Application Identity -------------------------------------------------

export interface ApplicationIdentity {
  /** Project ID. */
  projectId?: string;
  /** Project version. */
  projectVersion?: string;
  /** Adapter ID. */
  adapterId?: string;
  /** Adapter version. */
  adapterVersion?: string;
  /** Build ID (if available). */
  buildId?: string;
  /** Deployment version (if available). */
  deploymentVersion?: string;
  /** Application fingerprint. */
  fingerprint?: string;
}

// ---- Environment Identity -------------------------------------------------

export interface EnvironmentIdentity {
  /** Environment ID. */
  environmentId: string;
  /** Environment name. */
  environmentName?: string;
  /** Base URL. */
  baseUrl?: string;
  /** API base URL. */
  apiBaseUrl?: string;
  /** Database host. */
  databaseHost?: string;
  /** Environment fingerprint. */
  fingerprint?: string;
}

// ---- Runtime Data Identity ------------------------------------------------

export interface RuntimeDataIdentity {
  /** Entity type (e.g., "order"). */
  entityType?: string;
  /** Entity ID (e.g., "ORD-123"). */
  entityId?: string;
  /** Entity version/state fingerprint. */
  entityVersion?: string;
  /** State fingerprint. */
  stateFingerprint?: string;
  /** Whether this data is time-sensitive. */
  timeSensitive?: boolean;
}

// ---- Verification Policy Identity -----------------------------------------

export interface VerificationPolicyIdentity {
  /** Verification intent. */
  verificationIntent?: string;
  /** Authority rules. */
  authorityRules?: string[];
  /** Normalization mappings. */
  normalizationMappings?: string[];
  /** Policy fingerprint. */
  fingerprint?: string;
}

// ---- Capability Set -------------------------------------------------------

export interface CapabilitySet {
  /** Available executor types. */
  executorTypes: string[];
  /** Whether journey is enabled. */
  journeyEnabled: boolean;
  /** Additional capabilities. */
  additional?: string[];
}

// ---- Execution Decision ---------------------------------------------------

export type ExecutionDecision =
  | 'retest'
  | 'safe-reuse'
  | 'invalidated'
  | 'removed'
  | 'unknown-retest';

export type ExecutionReason =
  | 'requirement-changed'
  | 'testcase-changed'
  | 'expected-result-changed'
  | 'application-changed'
  | 'environment-changed'
  | 'data-changed'
  | 'verification-changed'
  | 'capability-changed'
  | 'evidence-expired'
  | 'unknown-freshness'
  | 'new-testcase'
  | 'removed-testcase'
  | 'legacy-evidence'
  | 'no-validity-context';

// ---- TestCase Execution Decision ------------------------------------------

export interface TestCaseExecutionDecision {
  /** TestCase ID. */
  testCaseId: string;
  /** Execution decision. */
  decision: ExecutionDecision;
  /** Reasons for this decision. */
  reasons: ExecutionReason[];
  /** Freshness matches per dimension. */
  freshnessMatches: Record<FreshnessDimension, FreshnessMatch>;
  /** Previous evidence ID (if reusing). */
  previousEvidenceId?: string;
  /** Previous run ID (if reusing). */
  previousRunId?: string;
  /** Previous execution timestamp (if reusing). */
  previousExecutionAt?: string;
}

// ---- Selective Execution Plan ---------------------------------------------

export interface SelectiveExecutionPlan {
  /** Schema version. */
  schemaVersion: '1.0';
  /** Base spec revision. */
  baseSpecRevision?: string;
  /** Target spec revision. */
  targetSpecRevision?: string;
  /** Base application identity. */
  baseApplication?: ApplicationIdentity;
  /** Target application identity. */
  targetApplication?: ApplicationIdentity;
  /** Base environment identity. */
  baseEnvironment?: EnvironmentIdentity;
  /** Target environment identity. */
  targetEnvironment?: EnvironmentIdentity;
  /** TestCases to execute. */
  toExecute: TestCaseExecutionDecision[];
  /** TestCases to reuse. */
  toReuse: TestCaseExecutionDecision[];
  /** TestCases invalidated. */
  invalidated: TestCaseExecutionDecision[];
  /** TestCases removed. */
  removed: TestCaseExecutionDecision[];
  /** TestCases with unknown freshness (must retest). */
  unknownRetest: TestCaseExecutionDecision[];
  /** Summary metrics. */
  summary: ExecutionPlanSummary;
}

// ---- Execution Plan Summary -----------------------------------------------

export interface ExecutionPlanSummary {
  /** Total TestCases. */
  testCasesTotal: number;
  /** TestCases to execute. */
  testCasesExecuted: number;
  /** TestCases to reuse. */
  testCasesReused: number;
  /** TestCases invalidated. */
  testCasesInvalidated: number;
  /** TestCases removed. */
  testCasesRemoved: number;
  /** Unknown freshness retests. */
  unknownRetests: number;
  /** Browser launches avoided. */
  browserLaunchesAvoided: number;
  /** Journey AI calls avoided. */
  journeyCallsAvoided: number;
}

// ---- Merged Requirement Result --------------------------------------------

export interface MergedRequirementResult {
  /** Requirement ID. */
  requirementId: string;
  /** Overall status. */
  status: 'passed' | 'failed' | 'blocked' | 'error';
  /** TestCase results. */
  testCaseResults: TestCaseResultMerge[];
  /** Evidence provenance. */
  evidenceProvenance: EvidenceProvenance[];
}

// ---- TestCase Result Merge ------------------------------------------------

export interface TestCaseResultMerge {
  /** TestCase ID. */
  testCaseId: string;
  /** Result source. */
  source: 'fresh-execution' | 'safe-reuse';
  /** Execution result (if fresh). */
  executionResult?: unknown;
  /** Reuse decision (if reused). */
  reuseDecision?: TestCaseExecutionDecision;
  /** Evidence references. */
  evidenceIds: string[];
}

// ---- Evidence Provenance --------------------------------------------------

export interface EvidenceProvenance {
  /** Evidence ID. */
  evidenceId: string;
  /** Whether this is fresh or reused. */
  source: 'fresh' | 'reused';
  /** Original run ID (if reused). */
  originalRunId?: string;
  /** Original execution timestamp (if reused). */
  originalExecutionAt?: string;
  /** Original application identity (if reused). */
  originalApplication?: ApplicationIdentity;
  /** Original environment identity (if reused). */
  originalEnvironment?: EnvironmentIdentity;
  /** Reuse decision (if reused). */
  reuseDecision?: TestCaseExecutionDecision;
}
