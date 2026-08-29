import { FakeAIProvider } from 'ai-provider';

// Deterministic, offline provider for the acceptance harness. It returns
// schema-valid responses for every AI pass of the three stages (semantic
// analysis, requirement building, test planning) so the integration can be
// exercised without network or a real LLM. The responses are NOT handwritten
// artifacts: they are injected through the architecture's own AIProvider
// channel (exactly how the project's own stage test suites run offline).

export function buildAcceptanceProvider(chunkIds: string[]): FakeAIProvider {
  const first = chunkIds[0] ?? 'ctx-unknown';

  const chunkResults = chunkIds.map((id) => ({
    contextId: id,
    sections: [{ localId: 'sec-1', title: 'Order Validation', provenance: [{ contextId: id }], confidence: 0.9 }],
    entities: [{ localId: 'ent-1', name: 'Order', type: 'domain', provenance: [{ contextId: id }], confidence: 0.9 }],
    flows: [],
    rules: [
      {
        localId: 'rule-1',
        type: 'validation',
        statement:
          'If quantity is greater than availableStock then the order must be rejected with reason INSUFFICIENT_STOCK.',
        conditions: [],
        effects: [],
        provenance: [{ contextId: id }],
        confidence: 0.9,
      },
    ],
    relationships: [],
    unresolved: [],
  }));

  const consolidation = {
    mergeCandidates: [],
    crossChunkRelationships: [],
    documentSummary: {
      title: 'Order Validation',
      summary: 'Business rule for order quantity versus available stock',
      language: ['en'],
      domainHints: ['order-management'],
    },
  };

  const extraction = {
    candidates: [
      {
        temporaryId: 'REQ-T-1',
        title: 'Order quantity must not exceed available stock',
        type: 'functional',
        statement:
          'The system must reject an order when its quantity exceeds the available stock, returning reason INSUFFICIENT_STOCK.',
        sourceNature: 'explicit',
        semanticEvidenceIds: ['rule-0000'],
        provenance: [{ contextId: first }],
        confidence: 0.9,
        preconditions: [],
        inputs: [
          { name: 'quantity', description: 'requested order quantity', provenance: [{ contextId: first }] },
          { name: 'availableStock', description: 'stock currently available', provenance: [{ contextId: first }] },
        ],
        dataNeeds: [],
        expectedBehaviors: [{ description: 'Order is rejected with reason INSUFFICIENT_STOCK', provenance: [{ contextId: first }] }],
        outcomes: [],
        constraints: [],
      },
    ],
    unresolvedCandidates: [],
    conflictCandidates: [],
  };

  const reqConsolidation = { duplicateGroups: [], additionalConflicts: [] };

  const coverage = {
    coverageCandidates: [
      { requirementId: 'REQ-0001', strategies: ['positive', 'negative', 'validation'], reasons: ['has constraints'], confidence: 0.9 },
    ],
    unresolvedCandidates: [],
  };

  const scenarios = {
    scenarios: [
      {
        temporaryId: 'SCN-T-1',
        title: 'Order is rejected when quantity exceeds available stock',
        objective: 'Verify the order is rejected with reason INSUFFICIENT_STOCK when quantity is greater than availableStock.',
        category: 'negative',
        requirementIds: ['REQ-0001'],
        preconditions: [],
        dataNeeds: [],
        expectedBehavior: ['Order is rejected', 'reason is INSUFFICIENT_STOCK'],
        priority: 'high',
        provenance: [{ requirementId: 'REQ-0001', contextId: first }],
        confidence: 0.9,
      },
    ],
  };

  const testcases = {
    testCases: [
      {
        temporaryId: 'TC-T-1',
        scenarioTemporaryId: 'SCN-T-1',
        requirementIds: ['REQ-0001'],
        title: 'Reject order when quantity exceeds available stock',
        objective: 'Submit an order with quantity greater than availableStock and expect rejection with INSUFFICIENT_STOCK.',
        type: 'api',
        priority: 'high',
        preconditions: [],
        inputs: [
          { name: 'quantity', valueStrategy: 'fixed', value: 10, description: 'requested quantity' },
          { name: 'availableStock', valueStrategy: 'fixed', value: 5, description: 'available stock' },
        ],
        dataNeeds: [],
        steps: [{ order: 1, action: 'Submit order with quantity=10 and availableStock=5', target: 'order service' }],
        expectedResults: [
          {
            description: 'Order rejected with reason INSUFFICIENT_STOCK',
            verificationType: 'state',
            verificationIntent: { kind: 'value-equals', expectedValue: 'INSUFFICIENT_STOCK' },
          },
        ],
        cleanup: [],
        automation: { status: 'manual-only', reasons: ['No automation target in acceptance harness'] },
        provenance: [{ requirementId: 'REQ-0001', contextId: first }],
        confidence: 0.9,
      },
    ],
    additionalDataNeeds: [],
    warnings: [],
  };

  const responses = [...chunkResults, consolidation, extraction, reqConsolidation, coverage, scenarios, testcases];

  return new FakeAIProvider({
    name: 'fake',
    model: 'fake-model',
    responses,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  });
}
