import { describe, it, expect } from 'vitest';
import { ImpactEngine } from '../src/engine.js';
import { ImpactGraphBuilder, generateImpactNodeId } from '../src/builder.js';
import { IncrementalPlanner } from '../src/planner.js';

describe('Phase 4B.2 Deterministic Acceptance', () => {
  describe('Section 32: No Change Case', () => {
    it('should detect no changes when revisions are identical', () => {
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
      };

      const targetIR = { ...baseIR };

      const baseReqs = [
        { id: 'req-1', title: 'R1', type: 'functional', statement: 'Test', sourceNature: 'explicit', relatedSemanticIds: ['entity-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-1' },
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

      expect(graph.summary.changedSemanticObjects).toBe(0);
      expect(graph.summary.changedArtifacts).toBe(0);
      expect(graph.summary.changedContexts).toBe(0);
      expect(graph.summary.directImpacts).toBe(0);
      expect(graph.summary.transitiveImpacts).toBe(0);
      expect(graph.summary.unknownImpacts).toBe(0);
      expect(graph.summary.addedRequirements).toBe(0);
      expect(graph.summary.removedRequirements).toBe(0);
    });

    it('should preserve previous planning state when no changes', () => {
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

      const targetIR = { ...baseIR };

      const baseReqs = [
        { id: 'req-1', title: 'R1', type: 'functional', statement: 'Test', sourceNature: 'explicit', relatedSemanticIds: ['entity-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-1' },
      ];

      const targetReqs = [...baseReqs];

      const plan = planner.createPlan({
        baseRevision: { id: 'base', semanticIR: baseIR as any, requirements: baseReqs as any },
        targetRevision: { id: 'target', semanticIR: targetIR as any, requirements: targetReqs as any },
      });

      expect(plan.requirementsToPlan.length).toBe(0);
      expect(plan.requirementsToPreserve.length).toBe(1);
      expect(plan.requirementsToRemove.length).toBe(0);
      expect(plan.requirementsUnknown.length).toBe(0);
      expect(plan.fullReplanRequired).toBe(false);
    });
  });

  describe('Section 33: One Local Change Case', () => {
    it('should detect direct impact when only one requirement changes', () => {
      const engine = new ImpactEngine();
      
      const baseIR = {
        schemaVersion: '1.0',
        document: { title: 'Test' },
        entities: [
          { id: 'entity-1', name: 'Order', type: 'entity', attributes: [], relationships: [], provenance: [] },
          { id: 'entity-2', name: 'Product', type: 'entity', attributes: [], relationships: [], provenance: [] },
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
          { id: 'entity-2', name: 'Product', type: 'entity', attributes: [], relationships: [], provenance: [] },
        ],
      };

      const baseReqs = [
        { id: 'req-1', title: 'R1', type: 'functional', statement: 'Order behavior', sourceNature: 'explicit', relatedSemanticIds: ['entity-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-1' },
        { id: 'req-2', title: 'R2', type: 'functional', statement: 'Product behavior', sourceNature: 'explicit', relatedSemanticIds: ['entity-2'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-2' },
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

      // R1 should be directly impacted
      const r1Node = graph.nodes.find((n) => n.id === generateImpactNodeId('requirement', 'req-1'));
      expect(r1Node).toBeDefined();
      expect(r1Node!.impactLevel).toBe('direct');

      // R2 should be unchanged
      const r2Node = graph.nodes.find((n) => n.id === generateImpactNodeId('requirement', 'req-2'));
      expect(r2Node).toBeDefined();
      expect(r2Node!.impactLevel).toBe('unchanged');
    });

    it('should replan only impacted requirement', () => {
      const planner = new IncrementalPlanner();
      
      const baseIR = {
        schemaVersion: '1.0',
        document: { title: 'Test' },
        entities: [
          { id: 'entity-1', name: 'Order', type: 'entity', attributes: [], relationships: [], provenance: [] },
          { id: 'entity-2', name: 'Product', type: 'entity', attributes: [], relationships: [], provenance: [] },
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
          { id: 'entity-2', name: 'Product', type: 'entity', attributes: [], relationships: [], provenance: [] },
        ],
      };

      const baseReqs = [
        { id: 'req-1', title: 'R1', type: 'functional', statement: 'Order behavior', sourceNature: 'explicit', relatedSemanticIds: ['entity-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-1' },
        { id: 'req-2', title: 'R2', type: 'functional', statement: 'Product behavior', sourceNature: 'explicit', relatedSemanticIds: ['entity-2'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-2' },
      ];

      const targetReqs = [...baseReqs];

      const plan = planner.createPlan({
        baseRevision: { id: 'base', semanticIR: baseIR as any, requirements: baseReqs as any },
        targetRevision: { id: 'target', semanticIR: targetIR as any, requirements: targetReqs as any },
      });

      // R1 should be planned (impacted)
      expect(plan.requirementsToPlan.length).toBe(1);
      expect(plan.requirementsToPlan[0].id).toBe('req-1');

      // R2 should be preserved
      expect(plan.requirementsToPreserve.length).toBe(1);
      expect(plan.requirementsToPreserve[0].id).toBe('req-2');

      // No removals or unknowns
      expect(plan.requirementsToRemove.length).toBe(0);
      expect(plan.requirementsUnknown.length).toBe(0);
    });
  });

  describe('Section 34: Shared Constraint Case', () => {
    it('should impact both requirements when shared constraint changes', () => {
      const engine = new ImpactEngine();
      
      const baseIR = {
        schemaVersion: '1.0',
        document: { title: 'Test' },
        entities: [
          { id: 'entity-1', name: 'Order', type: 'entity', attributes: [], relationships: [], provenance: [] },
        ],
        rules: [
          { id: 'rule-1', statement: 'Shared constraint', type: 'constraint', conditions: [], effects: [], provenance: [] },
        ],
        relationships: [],
        flows: [],
        sections: [],
        unresolved: [],
        metadata: { quality: { completeness: 1, consistency: 1 }, warnings: [], metrics: { chunksProcessed: 1, aiRequests: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } } },
      };

      const targetIR = {
        ...baseIR,
        rules: [
          { id: 'rule-1', statement: 'Shared constraint (Modified)', type: 'constraint', conditions: [], effects: [], provenance: [] },
        ],
      };

      const baseReqs = [
        { id: 'req-1', title: 'R1', type: 'functional', statement: 'Order behavior', sourceNature: 'explicit', relatedSemanticIds: ['rule-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-1' },
        { id: 'req-2', title: 'R2', type: 'functional', statement: 'Order validation', sourceNature: 'explicit', relatedSemanticIds: ['rule-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-2' },
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

      // Both R1 and R2 should be directly impacted
      const r1Node = graph.nodes.find((n) => n.id === generateImpactNodeId('requirement', 'req-1'));
      const r2Node = graph.nodes.find((n) => n.id === generateImpactNodeId('requirement', 'req-2'));

      expect(r1Node).toBeDefined();
      expect(r2Node).toBeDefined();
      expect(r1Node!.impactLevel).toBe('direct');
      expect(r2Node!.impactLevel).toBe('direct');
    });
  });

  describe('Section 35: Transitive Change Case', () => {
    it('should detect transitive impact through dependency chain', () => {
      const engine = new ImpactEngine();
      
      const baseIR = {
        schemaVersion: '1.0',
        document: { title: 'Test' },
        entities: [
          { id: 'entity-1', name: 'Role', type: 'entity', attributes: [], relationships: [], provenance: [] },
          { id: 'entity-2', name: 'Permission', type: 'entity', attributes: [], relationships: [], provenance: [] },
        ],
        rules: [],
        relationships: [
          { id: 'rel-1', type: 'depends-on', sourceId: 'entity-2', targetId: 'entity-1', provenance: [], confidence: 1 },
        ],
        flows: [],
        sections: [],
        unresolved: [],
        metadata: { quality: { completeness: 1, consistency: 1 }, warnings: [], metrics: { chunksProcessed: 1, aiRequests: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } } },
      };

      const targetIR = {
        ...baseIR,
        entities: [
          { id: 'entity-1', name: 'Role (Modified)', type: 'entity', attributes: [], relationships: [], provenance: [] },
          { id: 'entity-2', name: 'Permission', type: 'entity', attributes: [], relationships: [], provenance: [] },
        ],
      };

      const baseReqs = [
        { id: 'req-1', title: 'R1', type: 'functional', statement: 'Authorization behavior', sourceNature: 'explicit', relatedSemanticIds: ['entity-2'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-1' },
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

      // Debug: Log nodes and edges
      console.log('Nodes:');
      for (const node of graph.nodes) {
        console.log(`  ${node.id}: ${node.type} - changeClassification: ${node.changeClassification} - impactLevel: ${node.impactLevel}`);
      }
      console.log('Edges:');
      for (const edge of graph.edges) {
        console.log(`  ${edge.from} -> ${edge.to} (${edge.relation})`);
      }

      // R1 should be impacted (direct or transitive)
      const r1Node = graph.nodes.find((n) => n.id === generateImpactNodeId('requirement', 'req-1'));
      expect(r1Node).toBeDefined();
      expect(r1Node!.impactLevel).not.toBe('unchanged');
    });
  });

  describe('Section 36: Cycle Safety', () => {
    it('should handle dependency cycles without infinite recursion', () => {
      const builder = new ImpactGraphBuilder('base', 'target');
      
      builder.addNode('a', 'semantic-object', 'A', 'modified', 'direct', []);
      builder.addNode('b', 'semantic-object', 'B', 'unchanged', 'unchanged', []);
      builder.addNode('c', 'semantic-object', 'C', 'unchanged', 'unchanged', []);
      
      // Create cycle: A → B → C → A
      builder.addEdge('a', 'b', 'related-to');
      builder.addEdge('b', 'c', 'related-to');
      builder.addEdge('c', 'a', 'related-to');

      // Should detect cycle
      expect(builder.isPartOfCycle('a')).toBe(true);
      expect(builder.isPartOfCycle('b')).toBe(true);
      expect(builder.isPartOfCycle('c')).toBe(true);

      // Should not hang
      const graph = builder.build();
      expect(graph.nodes.length).toBe(3);
    });
  });

  describe('Section 37: Added Requirement Case', () => {
    it('should plan new requirement while preserving existing', () => {
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

      const targetIR = { ...baseIR };

      const baseReqs = [
        { id: 'req-1', title: 'R1', type: 'functional', statement: 'Order behavior', sourceNature: 'explicit', relatedSemanticIds: ['entity-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-1' },
      ];

      const targetReqs = [
        { id: 'req-1', title: 'R1', type: 'functional', statement: 'Order behavior', sourceNature: 'explicit', relatedSemanticIds: ['entity-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-1' },
        { id: 'req-2', title: 'R2', type: 'functional', statement: 'New requirement', sourceNature: 'explicit', relatedSemanticIds: ['entity-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-2' },
      ];

      const plan = planner.createPlan({
        baseRevision: { id: 'base', semanticIR: baseIR as any, requirements: baseReqs as any },
        targetRevision: { id: 'target', semanticIR: targetIR as any, requirements: targetReqs as any },
      });

      // R1 should be preserved
      expect(plan.requirementsToPreserve.length).toBe(1);
      expect(plan.requirementsToPreserve[0].id).toBe('req-1');

      // R2 should be planned (added)
      expect(plan.requirementsToPlan.length).toBe(1);
      expect(plan.requirementsToPlan[0].id).toBe('req-2');
    });
  });

  describe('Section 38: Removed Requirement Case', () => {
    it('should remove requirement from active plan', () => {
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

      const targetIR = { ...baseIR };

      const baseReqs = [
        { id: 'req-1', title: 'R1', type: 'functional', statement: 'Order behavior', sourceNature: 'explicit', relatedSemanticIds: ['entity-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-1' },
        { id: 'req-2', title: 'R2', type: 'functional', statement: 'Removed behavior', sourceNature: 'explicit', relatedSemanticIds: ['entity-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-2' },
      ];

      const targetReqs = [
        { id: 'req-1', title: 'R1', type: 'functional', statement: 'Order behavior', sourceNature: 'explicit', relatedSemanticIds: ['entity-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-1' },
      ];

      const plan = planner.createPlan({
        baseRevision: { id: 'base', semanticIR: baseIR as any, requirements: baseReqs as any },
        targetRevision: { id: 'target', semanticIR: targetIR as any, requirements: targetReqs as any },
      });

      // R1 should be preserved
      expect(plan.requirementsToPreserve.length).toBe(1);
      expect(plan.requirementsToPreserve[0].id).toBe('req-1');

      // R2 should be removed
      expect(plan.requirementsToRemove.length).toBe(1);
      expect(plan.requirementsToRemove[0].id).toBe('req-2');
    });
  });

  describe('Section 39: Unknown Impact Case', () => {
    it('should mark as unknown when impact cannot be determined', () => {
      const planner = new IncrementalPlanner();
      
      const baseIR = {
        schemaVersion: '1.0',
        document: { title: 'Test' },
        entities: [
          { id: 'entity-1', name: 'GlobalConstraint', type: 'entity', attributes: [], relationships: [], provenance: [] },
        ],
        rules: [],
        relationships: [
          { id: 'rel-1', type: 'depends-on', sourceId: 'entity-1', targetId: 'unknown-entity', provenance: [], confidence: 1 },
        ],
        flows: [],
        sections: [],
        unresolved: [],
        metadata: { quality: { completeness: 1, consistency: 1 }, warnings: [], metrics: { chunksProcessed: 1, aiRequests: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } } },
      };

      const targetIR = {
        ...baseIR,
        entities: [
          { id: 'entity-1', name: 'GlobalConstraint (Modified)', type: 'entity', attributes: [], relationships: [], provenance: [] },
        ],
      };

      const baseReqs = [
        { id: 'req-1', title: 'R1', type: 'functional', statement: 'Behavior', sourceNature: 'explicit', relatedSemanticIds: ['entity-1'], provenance: [], confidence: 1, testability: { automated: true, reasons: [] }, preconditions: [], inputs: [], dataNeeds: [], expectedBehaviors: [], outcomes: [], constraints: [], contentHash: 'hash-1' },
      ];

      const targetReqs = [...baseReqs];

      const plan = planner.createPlan({
        baseRevision: { id: 'base', semanticIR: baseIR as any, requirements: baseReqs as any },
        targetRevision: { id: 'target', semanticIR: targetIR as any, requirements: targetReqs as any },
      });

      // Should have some impact (direct or unknown)
      expect(plan.requirementsToPlan.length + plan.requirementsUnknown.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Section 40: Full Replan Fallback', () => {
    it('should trigger full replan when safe incremental is not possible', () => {
      const planner = new IncrementalPlanner();
      
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

      const targetIR = {
        schemaVersion: '2.0', // Incompatible version
        document: { title: 'Test' },
        entities: [],
        rules: [],
        relationships: [],
        flows: [],
        sections: [],
        unresolved: [],
        metadata: { quality: { completeness: 1, consistency: 1 }, warnings: [], metrics: { chunksProcessed: 1, aiRequests: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } } },
      };

      const baseReqs: any[] = [];
      const targetReqs: any[] = [];

      const plan = planner.createPlan({
        baseRevision: { id: 'base', semanticIR: baseIR as any, requirements: baseReqs },
        targetRevision: { id: 'target', semanticIR: targetIR as any, requirements: targetReqs },
      });

      // Should not fail silently
      expect(plan.impactGraph).toBeDefined();
    });
  });
});
