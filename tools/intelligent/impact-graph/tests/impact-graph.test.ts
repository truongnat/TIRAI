import { describe, it, expect } from 'vitest';
import { ImpactEngine } from '../src/engine.js';
import { ImpactGraphBuilder, generateImpactNodeId } from '../src/builder.js';
import { IncrementalPlanner } from '../src/planner.js';

describe('ImpactEngine', () => {
  it('should compute impact for modified semantic objects', () => {
    const engine = new ImpactEngine();
    
    const baseIR = {
      schemaVersion: '1.0',
      document: { title: 'Test' },
      entities: [
        { id: 'entity-1', name: 'Order', type: 'entity', attributes: [], relationships: [], provenance: [] },
      ],
      rules: [],
      relationships: [],
      flows: [],
      sections: [],
      unresolved: [],
      metadata: { quality: { completeness: 1, consistency: 1 }, warnings: [], metrics: { chunksProcessed: 1, aiRequests: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } } },
      revisionFingerprint: 'base-fingerprint',
    };

    const targetIR = {
      ...baseIR,
      entities: [
        { id: 'entity-1', name: 'Order (Modified)', type: 'entity', attributes: [], relationships: [], provenance: [] },
      ],
      revisionFingerprint: 'target-fingerprint',
    };

    const baseReqs = [
      { id: 'req-1', title: 'R1', type: 'functional', statement: 'Test', sourceNature: 'explicit', relatedSemanticIds: ['entity-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [] },
    ];

    const targetReqs = [...baseReqs];

    const graph = engine.computeImpact(
      'base-revision',
      'target-revision',
      'base-fingerprint',
      'target-fingerprint',
      baseIR as any,
      targetIR as any,
      baseReqs as any,
      targetReqs as any,
    );

    expect(graph.summary.changedSemanticObjects).toBe(1);
    // Check that the semantic object is directly impacted
    const semanticNodes = graph.nodes.filter((n) => n.type === 'semantic-object');
    expect(semanticNodes.length).toBe(1);
    expect(semanticNodes[0].impactLevel).toBe('direct');
  });

  it('should handle added requirements', () => {
    const engine = new ImpactEngine();
    
    const baseIR = {
      schemaVersion: '1.0',
      document: { title: 'Test' },
      entities: [],
      rules: [],
      relationships: [],
      flows: [],
      sections: [],
      unresolved: [],
      metadata: { quality: { completeness: 1, consistency: 1 }, warnings: [], metrics: { chunksProcessed: 1, aiRequests: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } } },
    };

    const targetIR = { ...baseIR };

    const baseReqs: any[] = [];

    const targetReqs = [
      { id: 'req-1', title: 'R1', type: 'functional', statement: 'Test', sourceNature: 'explicit', relatedSemanticIds: [], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [] },
    ];

    const graph = engine.computeImpact(
      'base-revision',
      'target-revision',
      undefined,
      undefined,
      baseIR as any,
      targetIR as any,
      baseReqs,
      targetReqs as any,
    );

    expect(graph.summary.addedRequirements).toBe(1);
  });

  it('should handle removed requirements', () => {
    const engine = new ImpactEngine();
    
    const baseIR = {
      schemaVersion: '1.0',
      document: { title: 'Test' },
      entities: [],
      rules: [],
      relationships: [],
      flows: [],
      sections: [],
      unresolved: [],
      metadata: { quality: { completeness: 1, consistency: 1 }, warnings: [], metrics: { chunksProcessed: 1, aiRequests: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } } },
    };

    const targetIR = { ...baseIR };

    const baseReqs = [
      { id: 'req-1', title: 'R1', type: 'functional', statement: 'Test', sourceNature: 'explicit', relatedSemanticIds: [], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [] },
    ];

    const targetReqs: any[] = [];

    const graph = engine.computeImpact(
      'base-revision',
      'target-revision',
      undefined,
      undefined,
      baseIR as any,
      targetIR as any,
      baseReqs as any,
      targetReqs,
    );

    expect(graph.summary.removedRequirements).toBe(1);
  });
});

describe('IncrementalPlanner', () => {
  it('should create incremental planning plan', () => {
    const planner = new IncrementalPlanner();
    
    const baseIR = {
      schemaVersion: '1.0',
      document: { title: 'Test' },
      entities: [
        { id: 'entity-1', name: 'Order', type: 'entity', attributes: [], relationships: [], provenance: [] },
      ],
      rules: [],
      relationships: [],
      flows: [],
      sections: [],
      unresolved: [],
      metadata: { quality: { completeness: 1, consistency: 1 }, warnings: [], metrics: { chunksProcessed: 1, aiRequests: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } } },
    };

    const targetIR = {
      ...baseIR,
      entities: [
        { id: 'entity-1', name: 'Order (Modified)', type: 'entity', attributes: [], relationships: [], provenance: [] },
      ],
    };

    const baseReqs = [
      { id: 'req-1', title: 'R1', type: 'functional', statement: 'Test', sourceNature: 'explicit', relatedSemanticIds: ['entity-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-1' },
    ];

    const targetReqs = [
      { id: 'req-1', title: 'R1 (Modified)', type: 'functional', statement: 'Test Modified', sourceNature: 'explicit', relatedSemanticIds: ['entity-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-2' },
    ];

    const plan = planner.createPlan({
      baseRevision: { id: 'base', semanticIR: baseIR as any, requirements: baseReqs as any },
      targetRevision: { id: 'target', semanticIR: targetIR as any, requirements: targetReqs as any },
    });

    // Check that at least one requirement is impacted
    const impactedRequirements = plan.requirementsToPlan.length;
    const unknownRequirements = plan.requirementsUnknown.length;
    expect(impactedRequirements + unknownRequirements).toBeGreaterThanOrEqual(1);
    expect(plan.impactGraph).toBeDefined();
  });
});

describe('ImpactGraphBuilder', () => {
  it('should build impact graph', () => {
    const builder = new ImpactGraphBuilder('base', 'target');
    
    builder.addNode('req-1', 'requirement', 'R1', 'modified', 'direct', ['direct-provenance']);
    builder.addNode('entity-1', 'semantic-object', 'Order', 'modified', 'direct', ['direct-provenance']);
    builder.addEdge('req-1', 'entity-1', 'depends-on', 'direct-semantic-reference');

    const graph = builder.build();

    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.length).toBe(1);
    expect(graph.summary.directImpacts).toBe(1);
  });

  it('should detect cycles', () => {
    const builder = new ImpactGraphBuilder('base', 'target');
    
    builder.addNode('a', 'semantic-object', 'A', 'modified', 'direct', []);
    builder.addNode('b', 'semantic-object', 'B', 'unchanged', 'unchanged', []);
    builder.addEdge('a', 'b', 'related-to');
    builder.addEdge('b', 'a', 'related-to');

    expect(builder.isPartOfCycle('a')).toBe(true);
  });
});
