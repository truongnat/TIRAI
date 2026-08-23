// Execution Mapping Builder — Input fingerprinting.
//
// Creates a deterministic hash of builder inputs to detect changes that
// invalidate checkpoints.

import { createHash } from 'node:crypto';
import type { TestCase, UIElementCatalog, BindingsCatalog } from './models.js';

export interface FingerprintInput {
  testCases: TestCase[];
  uiCatalog?: UIElementCatalog;
  bindingsCatalog?: BindingsCatalog;
  providerName?: string;
  model?: string;
}

export function computeFingerprint(input: FingerprintInput): string {
  const stable = {
    testCaseIds: input.testCases.map(tc => tc.id).sort(),
    testCaseCount: input.testCases.length,
    catalogPages: input.uiCatalog?.pages.map(p => p.id).sort() ?? [],
    catalogElements: input.uiCatalog?.pages.flatMap(p => p.elements.map(e => e.logicalName)).sort() ?? [],
    bindingNames: input.bindingsCatalog?.bindings.map(b => b.name).sort() ?? [],
    providerName: input.providerName ?? 'none',
    model: input.model ?? 'default',
  };

  const json = JSON.stringify(stable);
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}
