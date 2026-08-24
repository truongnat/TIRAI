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
}

export interface RuntimeApiCapability {
  available: boolean;
  readable: boolean;
  mutable: boolean;
  /** Explicit preparation operation IDs prevent invented endpoints. */
  allowedOperationIds?: string[];
  discovery?: RuntimeDiscoveryAdapter;
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
