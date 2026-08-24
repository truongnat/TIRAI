// ---------------------------------------------------------------------------
// Agentic Phase 2B.3 — policy-controlled preparation lifecycle
// ---------------------------------------------------------------------------
// This module is the boundary between semantic data requirements and mutable
// runtime capabilities.  It deliberately accepts callbacks instead of SQL,
// URLs, or credentials so an agent can never invent a mutation command.

import type {
  ExecutableDataPreparationIR,
  EnvironmentProfile,
  PreparationOperation,
} from 'data-resolver';
import type { TestDataItem } from 'test-data-planner';
import type {
  DataResolutionEvidence,
  DataResolutionResult,
} from '../models.js';
import { classifyDataNeed } from './data-resolver.js';
import type {
  RuntimeCapabilityInventory,
  RuntimeCleanupRequest,
  RuntimePreparationRequest,
  RuntimePreparationResult,
} from './runtime-capability-inventory.js';
import type { RuntimeDataStore } from './runtime-data-store.js';

export type PreparationExecutorKind = 'api' | 'database';

export type PreparationEnvironment =
  | 'production'
  | 'staging'
  | 'test'
  | 'development'
  | 'ephemeral'
  | 'unknown';

export type PreparedResourceOwnership =
  | 'EXTERNAL_EXISTING'
  | 'TEST_OWNED'
  | 'TEMPORARILY_MODIFIED';

export type PreparationStrategy =
  | 'REUSE_EXISTING'
  | 'CREATE_NEW'
  | 'UPDATE_TEMPORARILY'
  | 'DERIVE'
  | 'NO_PREPARATION'
  | 'BLOCKED';

export type PreparationMutationAction = 'create' | 'update' | 'restore' | 'delete';

export interface PreparationMutationPolicy {
  environment?: PreparationEnvironment;
  allowDatabaseRead: boolean;
  allowDatabaseInsert: boolean;
  allowDatabaseUpdate: boolean;
  allowDatabaseDelete: boolean;
  allowApiRead: boolean;
  allowApiCreate: boolean;
  allowApiUpdate: boolean;
  allowApiDelete: boolean;
  allowTemporaryUpdate: boolean;
  requireCleanupForCreatedResources: boolean;
  requireRestoreForExistingMutations: boolean;
  productionMutationDenied: boolean;
  allowUnknownIdempotency: boolean;
  preferredExecutors: PreparationExecutorKind[];
}

export function defaultPreparationMutationPolicy(): PreparationMutationPolicy {
  return {
    environment: undefined,
    allowDatabaseRead: false,
    allowDatabaseInsert: false,
    allowDatabaseUpdate: false,
    allowDatabaseDelete: false,
    allowApiRead: false,
    allowApiCreate: false,
    allowApiUpdate: false,
    allowApiDelete: false,
    allowTemporaryUpdate: false,
    requireCleanupForCreatedResources: true,
    requireRestoreForExistingMutations: true,
    productionMutationDenied: true,
    allowUnknownIdempotency: false,
    preferredExecutors: ['api', 'database'],
  };
}

export interface PreparationPolicyDecision {
  allowed: boolean;
  action: PreparationMutationAction | 'read' | 'unsupported';
  executor?: PreparationExecutorKind;
  strategy: PreparationStrategy;
  reason?: string;
}

export interface PreparationProof {
  dataItemId: string;
  operationId: string;
  executor: PreparationExecutorKind;
  action: PreparationMutationAction;
  strategy: Exclude<PreparationStrategy, 'BLOCKED' | 'NO_PREPARATION'>;
  ownership: PreparedResourceOwnership;
  bindingRef?: string;
  cleanupRequired: boolean;
  evidence: DataResolutionEvidence[];
}

export type PreparationJournalStatus =
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'cleaned'
  | 'cleanup-failed';

export interface PreparationJournalEntry {
  operationId: string;
  dataItemId: string;
  executor: PreparationExecutorKind;
  action: PreparationMutationAction;
  ownership: PreparedResourceOwnership;
  status: PreparationJournalStatus;
  cleanupOperationId?: string;
  /** Safe adapter-owned identifier; never a credential or raw response. */
  cleanupRef?: string;
  snapshotRef?: string;
  sensitive: boolean;
  dependencyOperationIds: string[];
  sequence: number;
  evidence: DataResolutionEvidence[];
}

export interface SafePreparationJournalEntry {
  operationId: string;
  dataItemId: string;
  executor: PreparationExecutorKind;
  action: PreparationMutationAction;
  ownership: PreparedResourceOwnership;
  status: PreparationJournalStatus;
  cleanupOperationId?: string;
  snapshotRef?: string;
  sensitive: boolean;
  dependencyOperationIds: string[];
  sequence: number;
  evidence: DataResolutionEvidence[];
}

export interface PreparationCleanupSummary {
  registered: number;
  attempted: number;
  succeeded: number;
  failed: number;
  orphaned: number;
  results: Array<{
    operationId: string;
    parentOperationId: string;
    action: 'restore' | 'delete';
    status: 'succeeded' | 'failed' | 'skipped';
    error?: string;
  }>;
}

export interface PreparationCoordinationInput {
  items: TestDataItem[];
  plan: ExecutableDataPreparationIR;
  resolutions: DataResolutionResult[];
  runtimeData: RuntimeDataStore;
  runId: string;
}

export interface PreparationCoordinationResult {
  status: 'ready' | 'blocked' | 'error';
  resolutions: DataResolutionResult[];
  runtimeData: RuntimeDataStore;
  journal: PreparationJournal;
  proofs: PreparationProof[];
  warnings: string[];
  cleanup: PreparationCleanupSummary;
}

export class PreparationJournal {
  private readonly entriesByOperation = new Map<string, PreparationJournalEntry>();
  private sequence = 0;

  start(input: Omit<PreparationJournalEntry, 'status' | 'sequence'>): PreparationJournalEntry {
    const entry: PreparationJournalEntry = {
      ...input,
      status: 'started',
      sequence: ++this.sequence,
      dependencyOperationIds: [...input.dependencyOperationIds],
      evidence: [...input.evidence],
    };
    this.entriesByOperation.set(entry.operationId, entry);
    return entry;
  }

  succeed(operationId: string, patch: Pick<PreparationJournalEntry, 'cleanupRef' | 'snapshotRef'>): void {
    const entry = this.entriesByOperation.get(operationId);
    if (!entry) return;
    entry.status = 'succeeded';
    entry.cleanupRef = patch.cleanupRef;
    entry.snapshotRef = patch.snapshotRef;
  }

  fail(operationId: string): void {
    const entry = this.entriesByOperation.get(operationId);
    if (entry) entry.status = 'failed';
  }

  markCleaned(operationId: string, success: boolean): void {
    const entry = this.entriesByOperation.get(operationId);
    if (entry) entry.status = success ? 'cleaned' : 'cleanup-failed';
  }

  entries(): PreparationJournalEntry[] {
    return [...this.entriesByOperation.values()].map((entry) => ({
      ...entry,
      dependencyOperationIds: [...entry.dependencyOperationIds],
      evidence: [...entry.evidence],
    }));
  }

  safeSnapshot(): SafePreparationJournalEntry[] {
    return this.entries().map(({ cleanupRef: _cleanupRef, ...entry }) => entry);
  }
}

export class RuntimePreparationCoordinator {
  private readonly inventory: RuntimeCapabilityInventory;
  private readonly policy: PreparationMutationPolicy;
  private readonly journal = new PreparationJournal();
  private readonly operationsById = new Map<string, PreparationOperation>();
  private readonly itemsById = new Map<string, TestDataItem>();
  private readonly environment: EnvironmentProfile;
  private currentRunId = 'unassigned';
  private lastCleanup?: PreparationCleanupSummary;

  constructor(options: {
    inventory: RuntimeCapabilityInventory;
    policy?: Partial<PreparationMutationPolicy>;
  }) {
    this.inventory = options.inventory;
    this.policy = {
      ...defaultPreparationMutationPolicy(),
      ...options.policy,
      preferredExecutors: options.policy?.preferredExecutors ?? ['api', 'database'],
    };
    this.environment = options.inventory.environment ?? {
      id: 'runtime-capability-inventory',
      resources: [],
      capabilities: [],
    };
  }

  getJournal(): PreparationJournal {
    return this.journal;
  }

  async prepare(input: PreparationCoordinationInput): Promise<PreparationCoordinationResult> {
    const runId = input.runId || 'phase2b-run';
    this.currentRunId = runId;
    for (const operation of input.plan.operations) this.operationsById.set(operation.id, operation);
    for (const item of input.items) this.itemsById.set(item.id, item);

    const resolutionsByItem = new Map(input.resolutions.map((resolution) => [resolution.dataItemId, resolution]));
    const proofs: PreparationProof[] = [];
    const warnings: string[] = [];
    let status: PreparationCoordinationResult['status'] = input.resolutions.some((resolution) => !resolution.resolved)
      ? 'blocked'
      : 'ready';

    for (const item of topologicalItemOrder(input.items)) {
      const current = resolutionsByItem.get(item.id);
      if (current?.resolved) continue;

      const unresolvedDependency = item.dependencies.find(
        (dependency) => !resolutionsByItem.get(dependency)?.resolved,
      );
      if (unresolvedDependency) {
        const blocked = blockedResolution(item, `Data dependency ${unresolvedDependency} was not resolved before preparation.`);
        resolutionsByItem.set(item.id, blocked);
        warnings.push(`${item.id}: ${blocked.reason}`);
        status = 'blocked';
        continue;
      }

      const operation = input.plan.operations.find((candidate) => candidate.dataItemId === item.id);
      if (!operation) continue;

      const decision = evaluatePreparationPolicy(item, operation, this.inventory, this.policy);
      if (decision.action === 'read' || decision.action === 'unsupported') continue;
      if (!decision.allowed || !decision.executor) {
        const blocked = blockedResolution(item, decision.reason ?? 'Preparation capability is not permitted.');
        resolutionsByItem.set(item.id, blocked);
        warnings.push(`${item.id}: ${blocked.reason}`);
        status = 'blocked';
        continue;
      }

      const adapter = getPreparationAdapter(this.inventory, decision.executor);
      if (!adapter) {
        const blocked = blockedResolution(item, `No explicit ${decision.executor} preparation adapter was supplied.`);
        resolutionsByItem.set(item.id, blocked);
        warnings.push(`${item.id}: ${blocked.reason}`);
        status = 'blocked';
        continue;
      }

      const dependencies = input.plan.dependencies
        .filter((dependency) => dependency.targetOperationId === operation.id)
        .map((dependency) => dependency.sourceOperationId);
      const request: RuntimePreparationRequest = {
        runId,
        item,
        operation,
        environment: this.environment,
        runtimeBindings: input.runtimeData.safeSnapshot(),
      };
      let snapshotRef: string | undefined;

      if (decision.action === 'update') {
        if (!adapter.snapshot) {
          const blocked = blockedResolution(item, 'Temporary update requires an explicit pre-mutation snapshot capability.');
          resolutionsByItem.set(item.id, blocked);
          warnings.push(`${item.id}: ${blocked.reason}`);
          status = 'blocked';
          continue;
        }
        try {
          const snapshot = await adapter.snapshot(request);
          snapshotRef = snapshot?.snapshotRef;
        } catch {
          snapshotRef = undefined;
        }
        if (!snapshotRef) {
          const blocked = blockedResolution(item, 'Pre-mutation snapshot could not be captured; update was not attempted.');
          resolutionsByItem.set(item.id, blocked);
          warnings.push(`${item.id}: ${blocked.reason}`);
          status = 'blocked';
          continue;
        }
      }

      const ownership: PreparedResourceOwnership = decision.action === 'update'
        ? 'TEMPORARILY_MODIFIED'
        : 'TEST_OWNED';
      const evidence: DataResolutionEvidence[] = [{
        kind: decision.executor,
        description: `${decision.executor.toUpperCase()} preparation executed through an explicit capability.`,
        reference: operation.id,
      }];
      this.journal.start({
        operationId: operation.id,
        dataItemId: item.id,
        executor: decision.executor,
        action: decision.action,
        ownership,
        cleanupOperationId: `CLEANUP-${operation.id}`,
        snapshotRef,
        sensitive: isSensitive(item),
        dependencyOperationIds: dependencies,
        evidence,
      });

      let prepared: RuntimePreparationResult | undefined;
      try {
        prepared = await adapter.prepare({ ...request, snapshotRef });
      } catch (error) {
        this.journal.fail(operation.id);
        warnings.push(`${item.id}: ${error instanceof Error ? error.message : String(error)}`);
        status = 'error';
        break;
      }

      const expectedOwnership = ownership;
      if (!prepared || prepared.value === undefined || prepared.ownership !== expectedOwnership) {
        this.journal.fail(operation.id);
        warnings.push(`${item.id}: preparation did not return a proven owned resource.`);
        status = 'error';
        break;
      }
      if (decision.action === 'create' && this.policy.requireCleanupForCreatedResources && !prepared.cleanupRef) {
        this.journal.fail(operation.id);
        warnings.push(`${item.id}: created resource has no safe cleanup reference.`);
        status = 'error';
        break;
      }

      this.journal.succeed(operation.id, {
        cleanupRef: prepared.cleanupRef,
        snapshotRef,
      });
      const preparedEvidence = sanitizeEvidence(
        prepared.evidence.length > 0 ? prepared.evidence : evidence,
        input.runtimeData,
        prepared.sensitive ? prepared.value : undefined,
      );
      const bindingRef = prepared.bindingRef ?? `runtime.${item.id}`;
      const sensitive = prepared.sensitive ?? isSensitive(item);
      input.runtimeData.bind({
        dataItemId: item.id,
        bindingRef,
        value: prepared.value,
        source: decision.executor,
        sensitive,
        evidence: preparedEvidence,
      });
      const resolution: DataResolutionResult = {
        dataItemId: item.id,
        status: 'RESOLVED',
        semantics: classifyDataNeed(item),
        source: decision.executor,
        bindingRef,
        sensitive,
        evidence: preparedEvidence.map((detail) => detail.description),
        evidenceDetails: preparedEvidence,
        value: sensitive ? undefined : primitiveString(prepared.value),
        resolved: true,
        preparation: {
          kind: decision.action === 'update' ? 'TEMPORARILY_MODIFIED' : 'CREATED',
          ownership,
          executor: decision.executor,
          operationId: operation.id,
          cleanupRequired: true,
        },
      };
      resolutionsByItem.set(item.id, resolution);
      proofs.push({
        dataItemId: item.id,
        operationId: operation.id,
        executor: decision.executor,
        action: decision.action,
        strategy: decision.action === 'update' ? 'UPDATE_TEMPORARILY' : operation.action === 'derive' ? 'DERIVE' : 'CREATE_NEW',
        ownership,
        bindingRef,
        cleanupRequired: true,
        evidence: preparedEvidence,
      });
      status = 'ready';
    }

    for (const item of input.items) {
      if (!resolutionsByItem.has(item.id)) {
        const blocked = blockedResolution(item, 'Data resolution did not complete before preparation.');
        resolutionsByItem.set(item.id, blocked);
        warnings.push(`${item.id}: ${blocked.reason}`);
      }
    }
    if (status !== 'error' && [...resolutionsByItem.values()].some((resolution) => !resolution.resolved)) {
      status = 'blocked';
    }
    const cleanup = status === 'error' ? await this.cleanup() : emptyCleanupSummary(this.journal);
    if (cleanup.failed > 0) status = 'error';
    return {
      status,
      resolutions: [...resolutionsByItem.values()],
      runtimeData: input.runtimeData,
      journal: this.journal,
      proofs,
      warnings,
      cleanup,
    };
  }

  async cleanup(): Promise<PreparationCleanupSummary> {
    if (this.lastCleanup) return this.lastCleanup;
    const entries = this.journal.entries()
      .filter((entry) => entry.status === 'succeeded' && entry.ownership !== 'EXTERNAL_EXISTING')
      .sort((left, right) => right.sequence - left.sequence);
    const summary: PreparationCleanupSummary = {
      registered: entries.length,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      orphaned: 0,
      results: [],
    };

    for (const entry of entries) {
      summary.attempted++;
      const operation = this.operationsById.get(entry.operationId);
      const item = this.itemsById.get(entry.dataItemId);
      const adapter = getPreparationAdapter(this.inventory, entry.executor);
      const action = entry.ownership === 'TEMPORARILY_MODIFIED' ? 'restore' : 'delete';
      if (!operation || !item || !adapter || (action === 'restore' ? !adapter.restore : !adapter.cleanup)) {
        summary.failed++;
        summary.orphaned++;
        this.journal.markCleaned(entry.operationId, false);
        summary.results.push({
          operationId: `CLEANUP-${entry.operationId}`,
          parentOperationId: entry.operationId,
          action,
          status: 'failed',
          error: 'No explicit cleanup capability was supplied.',
        });
        continue;
      }

      const request: RuntimeCleanupRequest = {
        runId: this.currentRunId,
        item,
        operation,
        environment: this.environment,
        journalEntry: entry,
      };
      try {
        if (action === 'restore') await adapter.restore!(request);
        else await adapter.cleanup!(request);
        summary.succeeded++;
        this.journal.markCleaned(entry.operationId, true);
        summary.results.push({
          operationId: `CLEANUP-${entry.operationId}`,
          parentOperationId: entry.operationId,
          action,
          status: 'succeeded',
        });
      } catch (error) {
        summary.failed++;
        summary.orphaned++;
        this.journal.markCleaned(entry.operationId, false);
        summary.results.push({
          operationId: `CLEANUP-${entry.operationId}`,
          parentOperationId: entry.operationId,
          action,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.lastCleanup = summary;
    return summary;
  }
}

export function evaluatePreparationPolicy(
  item: TestDataItem,
  operation: PreparationOperation,
  inventory: RuntimeCapabilityInventory,
  policyInput: Partial<PreparationMutationPolicy> = {},
): PreparationPolicyDecision {
  const policy = { ...defaultPreparationMutationPolicy(), ...policyInput };
  const executor = executorForOperation(operation, inventory, policy);
  const action = operationMutationAction(operation);
  if (!executor || !action) {
    return { allowed: false, action: action ?? 'unsupported', strategy: 'NO_PREPARATION', reason: 'Operation is not an explicit API or database mutation.' };
  }
  if (action === 'read') {
    const readAllowed = executor === 'api' ? policy.allowApiRead : policy.allowDatabaseRead;
    return { allowed: readAllowed, action, executor, strategy: 'REUSE_EXISTING', reason: readAllowed ? undefined : `${executor} read capability is not permitted.` };
  }

  const environment = policy.environment ?? resolveEnvironmentKind(inventory);
  if ((environment === 'production' && policy.productionMutationDenied) || environment === 'unknown') {
    return { allowed: false, action, executor, strategy: 'BLOCKED', reason: `Mutation is denied in ${environment} environment.` };
  }
  if (action === 'update' && !policy.allowTemporaryUpdate) {
    return { allowed: false, action, executor, strategy: 'UPDATE_TEMPORARILY', reason: 'Temporary update requires explicit update and restore policy.' };
  }

  const capabilityAvailable = executor === 'api'
    ? inventory.api.available && inventory.api.mutable
    : inventory.database.available && inventory.database.writable;
  if (!capabilityAvailable) {
    return { allowed: false, action, executor, strategy: 'BLOCKED', reason: `${executor} mutation capability is unavailable.` };
  }
  if (executor === 'api' && !inventory.api.allowedOperationIds?.includes(operation.id)) {
    return { allowed: false, action, executor, strategy: 'BLOCKED', reason: `API operation ${operation.id} is not explicitly allowlisted.` };
  }
  if (executor === 'api' && !operation.resourceId) {
    return { allowed: false, action, executor, strategy: 'BLOCKED', reason: 'API preparation requires an explicit resource mapping.' };
  }
  if (executor === 'database' && !isMappedDatabaseOperation(operation, inventory)) {
    return { allowed: false, action, executor, strategy: 'BLOCKED', reason: 'Database mutation has no explicit logical-entity/resource mapping.' };
  }

  const idempotency = operation.idempotency?.mode ?? 'unknown';
  if (idempotency === 'unknown' && !policy.allowUnknownIdempotency) {
    return { allowed: false, action, executor, strategy: 'BLOCKED', reason: 'Mutation idempotency is unknown.' };
  }
  const allowed = executor === 'api'
    ? action === 'create' ? policy.allowApiCreate : action === 'update' ? policy.allowApiUpdate : policy.allowApiDelete
    : action === 'create' ? policy.allowDatabaseInsert : action === 'update' ? policy.allowDatabaseUpdate : policy.allowDatabaseDelete;
  if (!allowed) {
    return { allowed: false, action, executor, strategy: action === 'update' ? 'UPDATE_TEMPORARILY' : 'CREATE_NEW', reason: `${executor} ${action} is not explicitly allowed by policy.` };
  }
  const adapter = getPreparationAdapter(inventory, executor);
  if (!adapter) {
    return { allowed: false, action, executor, strategy: 'BLOCKED', reason: `No explicit ${executor} preparation adapter was supplied.` };
  }
  if (action === 'create' && policy.requireCleanupForCreatedResources && !adapter.cleanup) {
    return { allowed: false, action, executor, strategy: 'BLOCKED', reason: 'Created resources require an explicit cleanup adapter.' };
  }
  if (action === 'update' && policy.requireRestoreForExistingMutations && !adapter.restore) {
    return { allowed: false, action, executor, strategy: 'BLOCKED', reason: 'Temporarily modified resources require an explicit restore adapter.' };
  }
  return {
    allowed: true,
    action,
    executor,
    strategy: action === 'update' ? 'UPDATE_TEMPORARILY' : operation.action === 'derive' ? 'DERIVE' : 'CREATE_NEW',
  };
}

function executorForOperation(
  operation: PreparationOperation,
  inventory: RuntimeCapabilityInventory,
  policy: PreparationMutationPolicy,
): PreparationExecutorKind | undefined {
  for (const candidate of policy.preferredExecutors) {
    if (candidate === 'api' && operation.resolver === 'api') return 'api';
    if (
      candidate === 'api' &&
      inventory.api.preparation &&
      inventory.api.preferredOperationIds?.includes(operation.id)
    ) return 'api';
    if (candidate === 'database' && operation.resolver === 'database') return 'database';
  }
  return operation.resolver === 'api' || operation.resolver === 'database' ? operation.resolver : undefined;
}

function operationMutationAction(operation: PreparationOperation): PreparationMutationAction | 'read' | undefined {
  const spec = operation.resolverSpec ?? {};
  const mode = typeof spec.mode === 'string' ? spec.mode.toLowerCase() : undefined;
  const method = typeof spec.methodIntent === 'string' ? spec.methodIntent.toUpperCase() : undefined;
  if (mode === 'select' || operation.action === 'select' || method === 'GET') return 'read';
  if (mode === 'update' || method === 'PATCH' || method === 'PUT') return 'update';
  // Restore is represented by the journal cleanup coordinator, never by an
  // initial preparation operation.
  if (mode === 'restore' || operation.action === 'restore') return undefined;
  if (mode === 'insert' || operation.action === 'create' || method === 'POST') return 'create';
  if (method === 'DELETE' || operation.action === 'copy') return undefined;
  return undefined;
}

function isMappedDatabaseOperation(operation: PreparationOperation, inventory: RuntimeCapabilityInventory): boolean {
  if (!operation.resourceId) return false;
  const spec = operation.resolverSpec ?? {};
  const entity = typeof spec.entity === 'string' ? spec.entity : String(operation.parameters.entity ?? '');
  if (!entity) return false;
  return [...inventory.resourceMappings, ...(inventory.database.mappings ?? [])].some((mapping) =>
    mapping.resourceId === operation.resourceId && mapping.logicalEntity.toLowerCase() === entity.toLowerCase(),
  );
}

function getPreparationAdapter(
  inventory: RuntimeCapabilityInventory,
  executor: PreparationExecutorKind,
) {
  return executor === 'api' ? inventory.api.preparation : inventory.database.preparation;
}

export function resolveEnvironmentKind(inventory: RuntimeCapabilityInventory): PreparationEnvironment {
  const raw = inventory.environmentKind ?? inventory.environment?.metadata?.environment ?? inventory.environment?.metadata?.environmentKind;
  if (typeof raw !== 'string') return 'unknown';
  switch (raw.toLowerCase()) {
    case 'prod':
    case 'production': return 'production';
    case 'staging': return 'staging';
    case 'test': return 'test';
    case 'dev':
    case 'development': return 'development';
    case 'ephemeral': return 'ephemeral';
    default: return 'unknown';
  }
}

function blockedResolution(item: TestDataItem, reason: string): DataResolutionResult {
  return {
    dataItemId: item.id,
    status: 'BLOCKED',
    semantics: classifyDataNeed(item),
    sensitive: isSensitive(item),
    evidence: ['Preparation was blocked by explicit capability or policy.'],
    resolved: false,
    reason,
    unresolvedReason: reason,
  };
}

function isSensitive(item: TestDataItem): boolean {
  return /\b(password|passcode|secret|token|credential|api key)\b/i.test(`${item.name} ${item.description}`);
}

function primitiveString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function sanitizeEvidence(
  evidence: DataResolutionEvidence[],
  runtimeData: RuntimeDataStore,
  additionalSensitiveValue?: unknown,
): DataResolutionEvidence[] {
  const sensitiveValues = runtimeData.all()
    .filter((binding) => binding.sensitive && typeof binding.value === 'string')
    .map((binding) => binding.value as string);
  if (typeof additionalSensitiveValue === 'string') sensitiveValues.push(additionalSensitiveValue);
  return evidence.map((detail) => {
    let replaced = false;
    const redact = (value: string | undefined): string | undefined => {
      if (value === undefined) return undefined;
      return sensitiveValues.reduce((current, secret) => {
        if (!secret) return current;
        if (current.includes(secret)) replaced = true;
        return current.split(secret).join('[REDACTED]');
      }, value);
    };
    return {
      ...detail,
      description: redact(detail.description) ?? '',
      reference: redact(detail.reference),
      sensitive: Boolean(detail.sensitive) || replaced,
    };
  });
}

function topologicalItemOrder(items: TestDataItem[]): TestDataItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const pending = new Set(items.map((item) => item.id));
  const ordered: TestDataItem[] = [];
  while (pending.size > 0) {
    const ready = [...pending].filter((id) => (byId.get(id)?.dependencies ?? []).every((dependency) => !pending.has(dependency)));
    if (ready.length === 0) return items;
    for (const id of ready) {
      pending.delete(id);
      ordered.push(byId.get(id)!);
    }
  }
  return ordered;
}

function emptyCleanupSummary(journal: PreparationJournal): PreparationCleanupSummary {
  const registered = journal.entries().filter((entry) => entry.status === 'succeeded' && entry.ownership !== 'EXTERNAL_EXISTING').length;
  return { registered, attempted: 0, succeeded: 0, failed: 0, orphaned: 0, results: [] };
}
