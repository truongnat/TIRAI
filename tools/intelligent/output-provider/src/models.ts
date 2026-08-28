// Output Provider Schema Version
export const OUTPUT_SCHEMA_VERSION = '1.0' as const;

// ============================================================================
// Core Types
// ============================================================================

export type ProviderId = string;
export type DeliveryKeyId = string;
export type PayloadFingerprint = string;
export type OutputId = string;

// ============================================================================
// Delivery Status Model (Section 15)
// ============================================================================

export type DeliveryStatus =
  | 'DELIVERED'
  | 'SKIPPED'
  | 'FAILED'
  | 'BLOCKED'
  | 'UNCHANGED';

// ============================================================================
// Output Provider Contract (Section 3)
// ============================================================================

export interface OutputProvider {
  readonly id: ProviderId;
  readonly displayName: string;

  deliver(
    payload: CanonicalOutputPayload,
    context: OutputDeliveryContext,
  ): Promise<OutputDeliveryResult>;
}

// ============================================================================
// Canonical Output Projection (Section 6)
// ============================================================================

export interface CanonicalOutputPayload {
  schemaVersion: string;
  runId: string;
  sourceRevision: SourceRevision;
  applicationRevision?: ApplicationRevision;
  requirements: RequirementResult[];
  testCases: TestCaseResult[];
  verificationSummary: VerificationSummary;
  evidenceOrigin: EvidenceOriginSummary;
  safeEvidenceReferences: SafeEvidenceReference[];
  traceSummary: TraceSummary;
  warnings: string[];
  errors: string[];
  timestamps: OutputTimestamps;
}

export interface SourceRevision {
  sourceId: string;
  revision: string;
  safeLocation?: string;
  contentHash?: string;
  revisionFingerprint?: string;
}

export interface ApplicationRevision {
  name: string;
  version?: string;
  fingerprint?: string;
  tracked: boolean;
}

export interface RequirementResult {
  requirementId: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'ERROR' | 'NOT_TESTED';
  testCaseIds: string[];
  evidenceIds: string[];
}

export interface TestCaseResult {
  testCaseId: string;
  requirementIds: string[];
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'ERROR' | 'SKIPPED' | 'MANUAL';
  proofOrigin: 'FRESH' | 'REUSED' | 'NOT_EXECUTED';
  evidenceIds: string[];
}

export interface VerificationSummary {
  totalRequirements: number;
  passed: number;
  failed: number;
  blocked: number;
  error: number;
  notTested: number;
  totalTestCases: number;
  testCasesPassed: number;
  testCasesFailed: number;
  testCasesBlocked: number;
  testCasesSkipped: number;
}

export interface EvidenceOriginSummary {
  freshEvidenceCount: number;
  reusedEvidenceCount: number;
  notTrackedCount: number;
}

export interface SafeEvidenceReference {
  evidenceId: string;
  type: string;
  sourceExecutor: string;
  safeArtifactRef?: string;
}

export interface TraceSummary {
  nodes: TraceNodeSummary[];
  edges: TraceEdgeSummary[];
}

export interface TraceNodeSummary {
  id: string;
  kind: string;
  ref: string;
}

export interface TraceEdgeSummary {
  from: string;
  to: string;
  relation: string;
}

export interface OutputTimestamps {
  runStartedAt?: string;
  runFinishedAt?: string;
  projectedAt: string;
}

// ============================================================================
// Output Delivery Context (Section 9)
// ============================================================================

export interface OutputDeliveryContext {
  providerId: ProviderId;
  target: OutputTarget;
  deliveryPolicy: DeliveryPolicy;
  dryRun: boolean;
}

export interface OutputTarget {
  type: string;
  path?: string;
  format?: string;
  [key: string]: unknown;
}

export type DeliveryPolicy = 'OVERWRITE_CURRENT' | 'APPEND_ONLY' | 'FAILED_ONLY';

// ============================================================================
// Delivery Key (Section 10)
// ============================================================================

export interface DeliveryKeyComponents {
  providerId: ProviderId;
  targetIdentity: string;
  runId: string;
}

// ============================================================================
// Delivery Result (Section 15)
// ============================================================================

export interface OutputDeliveryResult {
  success: boolean;
  status: DeliveryStatus;
  outputId: OutputId;
  deliveryKey: DeliveryKeyId;
  payloadFingerprint: PayloadFingerprint;
  providerId: ProviderId;
  target?: OutputTarget;
  artifactPath?: string;
  error?: string;
  metrics?: DeliveryMetrics;
}

// ============================================================================
// Delivery Journal (Section 13)
// ============================================================================

export interface DeliveryJournalEntry {
  id: string;
  deliveryKey: DeliveryKeyId;
  providerId: ProviderId;
  target: OutputTarget;
  payloadFingerprint: PayloadFingerprint;
  status: DeliveryStatus;
  sourceRevision?: string;
  resultRevision?: string;
  attempt: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryJournalStats {
  total: number;
  delivered: number;
  skipped: number;
  failed: number;
  blocked: number;
  unchanged: number;
}

// ============================================================================
// Provider Registry (Section 5)
// ============================================================================

export interface ProviderRegistry {
  register(provider: OutputProvider): void;
  resolve(providerId: ProviderId): OutputProvider;
  list(): OutputProvider[];
}

// ============================================================================
// Delivery Journal Interface
// ============================================================================

export interface DeliveryJournal {
  record(entry: Omit<DeliveryJournalEntry, 'id' | 'createdAt' | 'updatedAt' | 'attempt'>): Promise<DeliveryJournalEntry>;
  update(id: string, update: Partial<DeliveryJournalEntry>): Promise<DeliveryJournalEntry>;
  query(filter: { runId?: string; deliveryKey?: DeliveryKeyId; outputId?: string }): Promise<DeliveryJournalEntry[]>;
  get(id: string): Promise<DeliveryJournalEntry | null>;
  exists(deliveryKey: DeliveryKeyId): Promise<boolean>;
  getByDeliveryKey(deliveryKey: DeliveryKeyId): Promise<DeliveryJournalEntry | null>;
  stats(): Promise<DeliveryJournalStats>;
}

// ============================================================================
// Delivery Coordinator (Section 17)
// ============================================================================

export interface DeliveryCoordinatorConfig {
  registry: ProviderRegistry;
  journal: DeliveryJournal;
  defaultPolicy?: DeliveryPolicy;
}

export interface CoordinateDeliveryRequest {
  result: unknown;
  targets: OutputDeliveryTarget[];
  dryRun?: boolean;
}

export interface OutputDeliveryTarget {
  providerId: ProviderId;
  target: OutputTarget;
  policy?: DeliveryPolicy;
}

export interface CoordinateDeliveryResponse {
  results: OutputDeliveryResult[];
  aggregateStatus: AggregateDeliveryStatus;
  metrics: CoordinatorMetrics;
}

export type AggregateDeliveryStatus =
  | 'ALL_DELIVERED'
  | 'PARTIAL'
  | 'ALL_FAILED'
  | 'ALL_SKIPPED'
  | 'NO_PROVIDERS'
  | 'BLOCKED';

// ============================================================================
// Metrics (Section 52)
// ============================================================================

export interface DeliveryMetrics {
  deliveryAttempts: number;
  deliveryWrites: number;
  deliveryWritesAvoided: number;
  idempotentReplays: number;
}

export interface CoordinatorMetrics {
  providersConfigured: number;
  providersResolved: number;
  providersDelivered: number;
  providersFailed: number;
  providersSkipped: number;
  deliveryAttempts: number;
  deliveryWrites: number;
  deliveryWritesAvoided: number;
  idempotentReplays: number;
  payloadFingerprintsComputed: number;
  journalReads: number;
  journalWrites: number;
  reportsCreated: number;
  reportsUpdated: number;
  payloadsSanitized: number;
  secretLeakCount: number;
}

// ============================================================================
// Local Report Provider Config (Section 20)
// ============================================================================

export interface LocalReportProviderConfig {
  basePath: string;
  format?: 'markdown' | 'json';
}

// ============================================================================
// Sanitization (Section 29)
// ============================================================================

export interface SanitizationResult {
  sanitized: unknown;
  secretLeakCount: number;
  leaksFound: string[];
}
