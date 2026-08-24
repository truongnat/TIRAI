// ---------------------------------------------------------------------------
// Agentic Phase 2B — runtime capability inventory
//
// AgentCapabilities answers "is this broad capability available?". This
// inventory answers the narrower, fail-closed question "which operations are
// explicitly allowed, and which adapter can perform them?".
// ---------------------------------------------------------------------------

import type {
  EnvironmentProfile,
  PreparationOperation,
  ResourceMapping,
} from 'data-resolver';
import type { TestDataItem } from 'test-data-planner';
import type {
  AgentCapabilities,
  DataResolutionEvidence,
} from '../models.js';
import type {
  PreparationEnvironment,
  PreparationJournalEntry,
} from './preparation-lifecycle.js';

export interface RuntimeDiscoveryRequest {
  item: TestDataItem;
  operation?: PreparationOperation;
  environment: EnvironmentProfile;
}

export interface RuntimeDiscoveryResult {
  value: unknown;
  bindingRef?: string;
  sensitive?: boolean;
  evidence: DataResolutionEvidence[];
}

export type RuntimeDiscoveryAdapter =
  (request: RuntimeDiscoveryRequest) => Promise<RuntimeDiscoveryResult | undefined>;

export interface RuntimePreparationRequest {
  runId: string;
  item: TestDataItem;
  operation: PreparationOperation;
  environment: EnvironmentProfile;
  runtimeBindings: ReadonlyArray<{
    dataItemId: string;
    bindingRef: string;
    source: string;
    sensitive: boolean;
    evidence: DataResolutionEvidence[];
  }>;
  snapshotRef?: string;
}

export interface RuntimeSnapshotResult {
  /** Adapter-owned opaque reference; it must not contain a secret value. */
  snapshotRef: string;
  evidence?: DataResolutionEvidence[];
}

export interface RuntimePreparationResult {
  value: unknown;
  bindingRef?: string;
  ownership: 'TEST_OWNED' | 'TEMPORARILY_MODIFIED';
  cleanupRef?: string;
  sensitive?: boolean;
  evidence: DataResolutionEvidence[];
}

export interface RuntimeCleanupRequest {
  runId: string;
  item: TestDataItem;
  operation: PreparationOperation;
  environment: EnvironmentProfile;
  journalEntry: PreparationJournalEntry;
}

export interface RuntimePreparationAdapter {
  /** Execute one already-grounded operation. No SQL/URL may be inferred here. */
  prepare(request: RuntimePreparationRequest): Promise<RuntimePreparationResult>;
  /** Capture state before a temporary update is attempted. */
  snapshot?(request: RuntimePreparationRequest): Promise<RuntimeSnapshotResult | undefined>;
  /** Remove only a TEST_OWNED resource identified by cleanupRef. */
  cleanup?(request: RuntimeCleanupRequest): Promise<void>;
  /** Restore only a TEMPORARILY_MODIFIED resource identified by snapshotRef. */
  restore?(request: RuntimeCleanupRequest): Promise<void>;
}

export interface RuntimeBrowserCapability {
  available: boolean;
  discoverRuntimeState: boolean;
  discovery?: RuntimeDiscoveryAdapter;
}

export interface RuntimeDatabaseCapability {
  available: boolean;
  readable: boolean;
  writable: boolean;
  /** Explicit read mappings are required before a DB discovery adapter runs. */
  mappings?: ResourceMapping[];
  resourceIds?: string[];
  discovery?: RuntimeDiscoveryAdapter;
  preparation?: RuntimePreparationAdapter;
}

export interface RuntimeApiCapability {
  available: boolean;
  readable: boolean;
  mutable: boolean;
  /** Explicit preparation operation IDs prevent invented endpoints. */
  allowedOperationIds?: string[];
  /** Allows a domain API adapter to be preferred over a mapped DB path. */
  preferredOperationIds?: string[];
  discovery?: RuntimeDiscoveryAdapter;
  preparation?: RuntimePreparationAdapter;
}

export interface RuntimeSecretCapability {
  available: boolean;
  resolvable: boolean;
}

export interface RuntimeSourceCapability {
  available: boolean;
  inspectable: boolean;
}

export interface RuntimeFileCapability {
  available: boolean;
  readable: boolean;
}

export interface RuntimeCapabilityInventory {
  browser: RuntimeBrowserCapability;
  database: RuntimeDatabaseCapability;
  api: RuntimeApiCapability;
  secrets: RuntimeSecretCapability;
  source: RuntimeSourceCapability;
  files: RuntimeFileCapability;
  environment?: EnvironmentProfile;
  /** Must be explicit; unknown denies mutation. */
  environmentKind?: PreparationEnvironment;
  resourceMappings: ResourceMapping[];
}

export type RuntimeCapabilityInventoryOverrides = Partial<RuntimeCapabilityInventory>;

/**
 * Convert the legacy coarse capability flags to a fail-closed inventory.
 * AVAILABLE database/API flags do not grant read/write access by themselves.
 */
export function buildRuntimeCapabilityInventory(
  capabilities: AgentCapabilities,
  overrides: RuntimeCapabilityInventoryOverrides = {},
): RuntimeCapabilityInventory {
  return {
    browser: {
      available: capabilities.browser === 'AVAILABLE',
      discoverRuntimeState: false,
    },
    database: {
      available: capabilities.database === 'AVAILABLE',
      readable: false,
      writable: false,
    },
    api: {
      available: capabilities.api === 'AVAILABLE',
      readable: false,
      mutable: false,
    },
    secrets: {
      available: capabilities.secrets === 'AVAILABLE',
      resolvable: false,
    },
    source: {
      available: capabilities.source === 'AVAILABLE',
      inspectable: false,
    },
    files: {
      available: capabilities.files === 'AVAILABLE',
      readable: false,
    },
    resourceMappings: [],
    ...overrides,
  };
}

/**
 * Build the planning environment without inventing physical resources. The
 * caller may provide a richer frozen EnvironmentProfile when mappings or
 * resource metadata already exist.
 */
export function buildPlanningEnvironment(
  inventory: RuntimeCapabilityInventory,
): EnvironmentProfile {
  if (inventory.environment) return inventory.environment;

  const resources: EnvironmentProfile['resources'] = [];
  if (inventory.database.available) {
    resources.push({
      id: 'runtime-database',
      type: 'database',
      name: 'Runtime database capability',
      capabilities: [
        ...(inventory.database.readable ? ['select'] : []),
        ...(inventory.database.writable ? ['write'] : []),
      ],
      metadata: { phase2b: true },
    });
  }
  if (inventory.api.available) {
    resources.push({
      id: 'runtime-api',
      type: 'api',
      name: 'Runtime API capability',
      capabilities: [
        ...(inventory.api.readable ? ['read'] : []),
        ...(inventory.api.mutable ? ['mutate'] : []),
      ],
      metadata: { phase2b: true },
    });
  }

  return {
    id: 'runtime-capability-inventory',
    resources,
    capabilities: [],
    metadata: { phase2b: true },
  };
}
