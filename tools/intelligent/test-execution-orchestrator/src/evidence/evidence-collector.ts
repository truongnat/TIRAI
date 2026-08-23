// Test Execution Orchestrator v1 — Evidence collector.
//
// Deterministic evidence ID assignment (EVD-0001, EVD-0002, ...).
// Traces every evidence item to test case, step, and/or assertion.

import type {
  EvidenceCollector,
  EvidenceInput,
  EvidenceReference,
} from '../models.js';

export class InMemoryEvidenceCollector implements EvidenceCollector {
  private items: EvidenceReference[] = [];
  private counter = 0;

  add(input: EvidenceInput): EvidenceReference {
    this.counter++;
    const ref: EvidenceReference = {
      id: `EVD-${String(this.counter).padStart(4, '0')}`,
      type: input.type,
      sourceExecutor: input.sourceExecutor,
      testCaseId: input.testCaseId,
      stepOrder: input.stepOrder,
      assertionId: input.assertionId,
      artifactRef: input.artifactRef,
      metadata: input.metadata ?? {},
      sensitive: input.sensitive ?? false,
    };
    this.items.push(ref);
    return ref;
  }

  list(): EvidenceReference[] {
    return [...this.items];
  }

  reset(): void {
    this.items = [];
    this.counter = 0;
  }
}
