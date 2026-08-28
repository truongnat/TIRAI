import { ProviderId, DeliveryKeyId, PayloadFingerprint, OutputTarget } from './models.js';
export type { ProviderId, DeliveryKeyId, PayloadFingerprint, OutputTarget } from './models.js';

// ============================================================================
// Mutation Operation Types
// ============================================================================

export type MutationOperation = 'CREATE' | 'UPDATE' | 'NOOP' | 'RECONCILE';

// ============================================================================
// Mutation Outcome Types
// ============================================================================

export type MutationOutcome =
  | 'DEFINITELY_NOT_SENT'
  | 'CONFIRMED_SUCCESS'
  | 'CONFIRMED_FAILURE'
  | 'UNKNOWN_MUTATION_OUTCOME';

// ============================================================================
// Reconciliation State
// ============================================================================

export type ReconciliationState =
  | 'NOT_RECONCILED'
  | 'COMMITTED'
  | 'NOT_COMMITTED'
  | 'INCONCLUSIVE';

// ============================================================================
// Provider Capabilities
// ============================================================================

export interface ProviderCapabilities {
  canCreate: boolean;
  canUpdate: boolean;
  canReconcile: boolean;
  hasIdempotency: boolean;
  hasVersionGuard: boolean;
}

// ============================================================================
// Mutation Request
// ============================================================================

export interface MutationRequest {
  syncKey: DeliveryKeyId;
  providerId: ProviderId;
  target: OutputTarget;
  operation: MutationOperation;
  payload: unknown;
  payloadFingerprint: PayloadFingerprint;
  expectedRemoteVersion?: number;
  idempotencyKey?: string;
  dryRun: boolean;
  readOnly: boolean;
}

// ============================================================================
// Mutation Result
// ============================================================================

export interface MutationResult {
  success: boolean;
  operation: MutationOperation;
  outcome: MutationOutcome;
  syncKey: DeliveryKeyId;
  providerId: ProviderId;
  externalRef?: ExternalReference;
  remoteVersion?: number;
  error?: string;
  metrics: MutationMetrics;
}

// ============================================================================
// External Reference
// ============================================================================

export interface ExternalReference {
  externalId: string;
  providerId: ProviderId;
  syncKey: DeliveryKeyId;
  destination: string;
  remoteVersion: number;
  payloadFingerprint: PayloadFingerprint;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Mutation Journal Entry
// ============================================================================

export interface MutationJournalEntry {
  id: string;
  syncKey: DeliveryKeyId;
  providerId: ProviderId;
  operation: MutationOperation;
  idempotencyKey?: string;
  externalRef?: ExternalReference;
  payloadFingerprint: PayloadFingerprint;
  outcome: MutationOutcome;
  reconciliationState: ReconciliationState;
  attempt: number;
  safeRetries: number;
  unsafeRetries: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Mutation Journal Stats
// ============================================================================

export interface MutationJournalStats {
  total: number;
  createAttempts: number;
  updateAttempts: number;
  noopDeliveries: number;
  confirmedSuccess: number;
  confirmedFailure: number;
  unknownOutcome: number;
  safeRetries: number;
  unsafeRetries: number;
}

// ============================================================================
// Mutation Metrics
// ============================================================================

export interface MutationMetrics {
  mutationPlans: number;
  createAttempts: number;
  createCommits: number;
  updateAttempts: number;
  updateCommits: number;
  noopDeliveries: number;
  safeRetries: number;
  unsafeRetries: number;
  ambiguousMutationOutcomes: number;
  reconciliationAttempts: number;
  reconciliationConfirmedCommitted: number;
  reconciliationConfirmedNotCommitted: number;
  reconciliationInconclusive: number;
  staleWritesPrevented: number;
  idempotencyKeysUsed: number;
  idempotentDuplicatesPrevented: number;
  externalRefsPersisted: number;
  authorizationBlocks: number;
  readOnlyBlocks: number;
  secretLeakCount: number;
}

// ============================================================================
// Mutation Journal Interface
// ============================================================================

export interface MutationJournal {
  record(entry: Omit<MutationJournalEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MutationJournalEntry>;
  update(id: string, update: Partial<MutationJournalEntry>): Promise<MutationJournalEntry>;
  getBySyncKey(syncKey: DeliveryKeyId): Promise<MutationJournalEntry | null>;
  getByIdempotencyKey(idempotencyKey: string): Promise<MutationJournalEntry | null>;
  query(filter: { syncKey?: DeliveryKeyId; providerId?: ProviderId; operation?: MutationOperation }): Promise<MutationJournalEntry[]>;
  stats(): Promise<MutationJournalStats>;
}

// ============================================================================
// Mutation Provider Interface
// ============================================================================

export interface MutationProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  create(request: CreateMutationRequest): Promise<CreateMutationResult>;
  update(request: UpdateMutationRequest): Promise<UpdateMutationResult>;
  reconcile(request: ReconcileRequest): Promise<ReconcileResult>;
}

// ============================================================================
// Create Mutation
// ============================================================================

export interface CreateMutationRequest {
  syncKey: DeliveryKeyId;
  payload: unknown;
  idempotencyKey?: string;
  dryRun: boolean;
}

export interface CreateMutationResult {
  success: boolean;
  outcome: MutationOutcome;
  externalRef?: ExternalReference;
  error?: string;
}

// ============================================================================
// Update Mutation
// ============================================================================

export interface UpdateMutationRequest {
  syncKey: DeliveryKeyId;
  externalRef: ExternalReference;
  payload: unknown;
  expectedRemoteVersion: number;
  idempotencyKey?: string;
  dryRun: boolean;
}

export interface UpdateMutationResult {
  success: boolean;
  outcome: MutationOutcome;
  externalRef?: ExternalReference;
  staleWriteRejected?: boolean;
  error?: string;
}

// ============================================================================
// Reconcile Request
// ============================================================================

export interface ReconcileRequest {
  syncKey: DeliveryKeyId;
  externalRef?: ExternalReference;
  idempotencyKey?: string;
}

export interface ReconcileResult {
  success: boolean;
  state: ReconciliationState;
  externalRef?: ExternalReference;
  error?: string;
}

// ============================================================================
// Mutation Coordinator Config
// ============================================================================

export interface MutationCoordinatorConfig {
  journal: MutationJournal;
  defaultTimeoutMs?: number;
  maxSafeRetries?: number;
}
