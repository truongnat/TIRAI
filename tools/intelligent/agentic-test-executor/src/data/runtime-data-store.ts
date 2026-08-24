// ---------------------------------------------------------------------------
// Agentic Phase 2B — protected runtime data store
// ---------------------------------------------------------------------------

import type { RuntimeBindingResult } from 'execution-engine';
import type {
  DataResolutionEvidence,
  DataResolutionSource,
} from '../models.js';

export interface RuntimeDataBinding {
  dataItemId: string;
  bindingRef: string;
  value: unknown;
  source: DataResolutionSource;
  sensitive: boolean;
  evidence: DataResolutionEvidence[];
}

export interface SafeRuntimeDataBinding {
  dataItemId: string;
  bindingRef: string;
  source: DataResolutionSource;
  sensitive: boolean;
  evidence: DataResolutionEvidence[];
}

/**
 * Holds concrete values only for the duration of one execution. Safe views
 * intentionally omit every value marked sensitive.
 */
export class RuntimeDataStore {
  private readonly entries = new Map<string, RuntimeDataBinding>();

  bind(binding: RuntimeDataBinding): void {
    this.entries.set(binding.dataItemId, binding);
    this.entries.set(binding.bindingRef, binding);
  }

  resolve(reference: string): unknown {
    const normalized = reference.startsWith('testdata://')
      ? reference.slice('testdata://'.length)
      : reference;
    const entry = this.entries.get(normalized)
      ?? this.entries.get(normalized.replace(/^runtime\./, ''));
    return entry?.value;
  }

  get(dataItemId: string): RuntimeDataBinding | undefined {
    return this.entries.get(dataItemId);
  }

  all(): RuntimeDataBinding[] {
    return [...new Set(this.entries.values())];
  }

  safeSnapshot(): SafeRuntimeDataBinding[] {
    return this.all().map((entry) => ({
      dataItemId: entry.dataItemId,
      bindingRef: entry.bindingRef,
      source: entry.source,
      sensitive: entry.sensitive,
      evidence: entry.evidence,
    }));
  }

  toBindingResults(): RuntimeBindingResult[] {
    return this.all().map((entry) => ({
      id: `DATA-${entry.dataItemId}`,
      name: entry.bindingRef,
      producerOperationId: `DATA-PREP-${entry.dataItemId}`,
      value: entry.value,
      sensitive: entry.sensitive,
      status: 'resolved',
    }));
  }
}
