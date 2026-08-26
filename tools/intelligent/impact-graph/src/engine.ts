// ---------------------------------------------------------------------------
// Impact Engine — Computes impacts from canonical diffs
// ---------------------------------------------------------------------------
// Takes canonical diffs and computes impact levels for semantic objects,
// requirements, scenarios, and test cases.

import type { SemanticIR, SemanticEntity, SemanticRule, SemanticRelationship } from 'semantic-analyzer';
import type { Requirement } from 'requirement-builder';
import type {
  ImpactGraph,
  ImpactNode,
  ImpactLevel,
  ChangeClassification,
  ImpactReason,
} from './models.js';
import { ImpactGraphBuilder, generateImpactNodeId, computeFingerprint } from './builder.js';

// ---- Impact Engine --------------------------------------------------------

export class ImpactEngine {
  /**
   * Compute impact graph from base and target revisions.
   */
  computeImpact(
    baseRevisionId: string,
    targetRevisionId: string,
    baseFingerprint: string | undefined,
    targetFingerprint: string | undefined,
    baseSemanticIR: SemanticIR,
    targetSemanticIR: SemanticIR,
    baseRequirements: Requirement[],
    targetRequirements: Requirement[],
  ): ImpactGraph {
    const builder = new ImpactGraphBuilder(
      baseRevisionId,
      targetRevisionId,
      baseFingerprint,
      targetFingerprint,
    );

    // Step 1: Analyze semantic objects
    this.analyzeSemanticObjects(
      builder,
      baseSemanticIR,
      targetSemanticIR,
    );

    // Step 2: Analyze requirements
    this.analyzeRequirements(
      builder,
      baseRequirements,
      targetRequirements,
    );

    // Step 3: Build dependency edges
    this.buildDependencyEdges(
      builder,
      baseSemanticIR,
      targetSemanticIR,
      baseRequirements,
      targetRequirements,
    );

    // Step 4: Propagate impact levels
    this.propagateImpact(builder);

    // Step 5: Handle unknown impacts
    this.handleUnknownImpacts(builder);

    return builder.build();
  }

  // ---- Step 1: Analyze Semantic Objects -----------------------------------

  private analyzeSemanticObjects(
    builder: ImpactGraphBuilder,
    baseIR: SemanticIR,
    targetIR: SemanticIR,
  ): void {
    // Create maps for comparison
    const baseEntityMap = new Map<string, SemanticEntity>();
    for (const entity of baseIR.entities) {
      baseEntityMap.set(entity.id, entity);
    }

    const targetEntityMap = new Map<string, SemanticEntity>();
    for (const entity of targetIR.entities) {
      targetEntityMap.set(entity.id, entity);
    }

    // Analyze entities
    for (const [id, entity] of targetEntityMap) {
      const baseEntity = baseEntityMap.get(id);
      const nodeId = generateImpactNodeId('semantic-object', id);

      if (!baseEntity) {
        // Added entity
        builder.addNode(
          nodeId,
          'semantic-object',
          entity.name,
          'added',
          'direct',
          ['added-requirement'],
          entity,
        );
      } else if (computeFingerprint(baseEntity) !== computeFingerprint(entity)) {
        // Modified entity
        builder.addNode(
          nodeId,
          'semantic-object',
          entity.name,
          'modified',
          'unknown', // Will be updated during propagation
          ['unknown-blast-radius'],
          entity,
        );
      } else {
        // Unchanged entity
        builder.addNode(
          nodeId,
          'semantic-object',
          entity.name,
          'unchanged',
          'unchanged',
          [],
          entity,
        );
      }
    }

    // Check for removed entities
    for (const [id, entity] of baseEntityMap) {
      if (!targetEntityMap.has(id)) {
        const nodeId = generateImpactNodeId('semantic-object', id);
        builder.addNode(
          nodeId,
          'semantic-object',
          entity.name,
          'removed',
          'direct',
          ['removed-requirement'],
          entity,
        );
      }
    }

    // Analyze rules
    const baseRuleMap = new Map<string, SemanticRule>();
    for (const rule of baseIR.rules) {
      baseRuleMap.set(rule.id, rule);
    }

    const targetRuleMap = new Map<string, SemanticRule>();
    for (const rule of targetIR.rules) {
      targetRuleMap.set(rule.id, rule);
    }

    for (const [id, rule] of targetRuleMap) {
      const baseRule = baseRuleMap.get(id);
      const nodeId = generateImpactNodeId('semantic-object', id);

      if (!baseRule) {
        builder.addNode(
          nodeId,
          'semantic-object',
          rule.statement,
          'added',
          'direct',
          ['added-requirement'],
          rule,
        );
      } else if (computeFingerprint(baseRule) !== computeFingerprint(rule)) {
        builder.addNode(
          nodeId,
          'semantic-object',
          rule.statement,
          'modified',
          'unknown',
          ['unknown-blast-radius'],
          rule,
        );
      } else {
        builder.addNode(
          nodeId,
          'semantic-object',
          rule.statement,
          'unchanged',
          'unchanged',
          [],
          rule,
        );
      }
    }

    for (const [id, rule] of baseRuleMap) {
      if (!targetRuleMap.has(id)) {
        const nodeId = generateImpactNodeId('semantic-object', id);
        builder.addNode(
          nodeId,
          'semantic-object',
          rule.statement,
          'removed',
          'direct',
          ['removed-requirement'],
          rule,
        );
      }
    }
  }

  // ---- Step 2: Analyze Requirements --------------------------------------

  private analyzeRequirements(
    builder: ImpactGraphBuilder,
    baseRequirements: Requirement[],
    targetRequirements: Requirement[],
  ): void {
    const baseReqMap = new Map<string, Requirement>();
    for (const req of baseRequirements) {
      baseReqMap.set(req.id, req);
    }

    const targetReqMap = new Map<string, Requirement>();
    for (const req of targetRequirements) {
      targetReqMap.set(req.id, req);
    }

    // Analyze target requirements
    for (const [id, req] of targetReqMap) {
      const baseReq = baseReqMap.get(id);
      const nodeId = generateImpactNodeId('requirement', id);

      if (!baseReq) {
        // Added requirement
        builder.addNode(
          nodeId,
          'requirement',
          req.title,
          'added',
          'direct',
          ['added-requirement'],
          req,
        );
      } else if (req.contentHash !== baseReq.contentHash) {
        // Modified requirement
        builder.addNode(
          nodeId,
          'requirement',
          req.title,
          'modified',
          'direct', // Directly impacted by modification
          ['direct-provenance'],
          req,
        );
      } else {
        // Unchanged requirement
        builder.addNode(
          nodeId,
          'requirement',
          req.title,
          'unchanged',
          'unchanged',
          [],
          req,
        );
      }
    }

    // Check for removed requirements
    for (const [id, req] of baseReqMap) {
      if (!targetReqMap.has(id)) {
        const nodeId = generateImpactNodeId('requirement', id);
        builder.addNode(
          nodeId,
          'requirement',
          req.title,
          'removed',
          'direct',
          ['removed-requirement'],
          req,
        );
      }
    }
  }

  // ---- Step 3: Build Dependency Edges ------------------------------------

  private buildDependencyEdges(
    builder: ImpactGraphBuilder,
    baseIR: SemanticIR,
    targetIR: SemanticIR,
    baseRequirements: Requirement[],
    targetRequirements: Requirement[],
  ): void {
    // Build edges from requirements to semantic objects
    for (const req of targetRequirements) {
      const reqNodeId = generateImpactNodeId('requirement', req.id);
      for (const semanticId of req.relatedSemanticIds) {
        const semanticNodeId = generateImpactNodeId('semantic-object', semanticId);
        builder.addEdge(reqNodeId, semanticNodeId, 'depends-on', 'direct-semantic-reference');
      }
    }

    // Build edges from semantic relationships
    // The relationship type in SemanticIR is 'type' field
    for (const rel of targetIR.relationships) {
      const sourceNodeId = generateImpactNodeId('semantic-object', rel.sourceId);
      const targetNodeId = generateImpactNodeId('semantic-object', rel.targetId);
      // Use the relationship type from the semantic IR
      const relation = rel.type === 'depends-on' ? 'depends-on' : 'related-to';
      builder.addEdge(sourceNodeId, targetNodeId, relation, 'dependency-edge');
    }
  }

  // ---- Step 4: Propagate Impact Levels -----------------------------------

  private propagateImpact(builder: ImpactGraphBuilder): void {
    const semanticNodes = builder.getNodesByType('semantic-object');
    const requirementNodes = builder.getNodesByType('requirement');

    // First pass: Mark directly impacted semantic objects
    for (const node of semanticNodes) {
      if (node.changeClassification === 'modified' || node.changeClassification === 'added') {
        node.impactLevel = 'direct';
        node.impactReasons = ['direct-provenance'];
      }
    }

    // Second pass: Propagate transitive impacts between semantic objects
    // If a semantic object depends on a directly impacted object, it becomes transitive
    let changed = true;
    let iterations = 0;
    const maxIterations = 10; // Prevent infinite loops

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const node of semanticNodes) {
        if (node.impactLevel === 'unchanged') {
          // Check if this node depends on any impacted node
          const outgoingEdges = builder.getOutgoingEdges(node.id);
          for (const edge of outgoingEdges) {
            if (edge.relation === 'related-to' || edge.relation === 'depends-on') {
              const targetNode = builder.getNode(edge.to);
              if (targetNode && targetNode.impactLevel !== 'unchanged') {
                node.impactLevel = 'transitive';
                node.impactReasons = ['transitive-dependency'];
                changed = true;
                break;
              }
            }
          }
        }
      }
    }

    // Third pass: Propagate from semantic objects to requirements
    for (const reqNode of requirementNodes) {
      if (reqNode.changeClassification === 'added' || reqNode.changeClassification === 'removed') {
        continue; // Already handled
      }

      const outgoingEdges = builder.getOutgoingEdges(reqNode.id);
      let hasDirectImpact = false;
      let hasTransitiveImpact = false;
      const reasons: ImpactReason[] = [];

      for (const edge of outgoingEdges) {
        if (edge.relation === 'depends-on') {
          const semanticNode = builder.getNode(edge.to);
          if (semanticNode && semanticNode.type === 'semantic-object') {
            if (semanticNode.impactLevel === 'direct') {
              hasDirectImpact = true;
              reasons.push('direct-semantic-reference');
            } else if (semanticNode.impactLevel === 'transitive') {
              hasTransitiveImpact = true;
              reasons.push('transitive-dependency');
            }
          }
        }
      }

      if (hasDirectImpact) {
        reqNode.impactLevel = 'direct';
        reqNode.impactReasons = [...new Set([...reqNode.impactReasons, ...reasons])];
      } else if (hasTransitiveImpact) {
        reqNode.impactLevel = 'transitive';
        reqNode.impactReasons = [...new Set([...reqNode.impactReasons, ...reasons])];
      }
    }
  }

  // ---- Step 5: Handle Unknown Impacts ------------------------------------

  private handleUnknownImpacts(builder: ImpactGraphBuilder): void {
    const semanticNodes = builder.getNodesByType('semantic-object');
    const requirementNodes = builder.getNodesByType('requirement');

    // Mark remaining unchanged semantic objects as unknown if they have
    // relationships to impacted objects
    for (const node of semanticNodes) {
      if (node.impactLevel === 'unchanged') {
        const incomingEdges = builder.getIncomingEdges(node.id);
        const outgoingEdges = builder.getOutgoingEdges(node.id);

        let hasImpactedConnection = false;
        for (const edge of [...incomingEdges, ...outgoingEdges]) {
          const connectedNode = builder.getNode(edge.from === node.id ? edge.to : edge.from);
          if (connectedNode && connectedNode.impactLevel !== 'unchanged') {
            hasImpactedConnection = true;
            break;
          }
        }

        if (hasImpactedConnection) {
          node.impactLevel = 'unknown';
          node.impactReasons = ['unknown-blast-radius'];
        }
      }
    }

    // Mark remaining unchanged requirements as unknown if they have
    // relationships to impacted semantic objects
    for (const node of requirementNodes) {
      if (node.impactLevel === 'unchanged') {
        const incomingEdges = builder.getIncomingEdges(node.id);

        let hasImpactedConnection = false;
        for (const edge of incomingEdges) {
          const semanticNode = builder.getNode(edge.from);
          if (semanticNode && semanticNode.impactLevel !== 'unchanged') {
            hasImpactedConnection = true;
            break;
          }
        }

        if (hasImpactedConnection) {
          node.impactLevel = 'unknown';
          node.impactReasons = ['unknown-blast-radius'];
        }
      }
    }
  }
}
