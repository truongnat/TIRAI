// ---------------------------------------------------------------------------
// Impact Graph Builder — Constructs the impact graph from diffs and IRs
// ---------------------------------------------------------------------------
// Builds the canonical impact graph from semantic diffs, requirement diffs,
// and dependency relationships.

import { sha256, canonicalJson } from 'fingerprint';
import type { SemanticIR, SemanticEntity, SemanticRule, SemanticRelationship } from 'semantic-analyzer';
import type { Requirement } from 'requirement-builder';
import type {
  ImpactGraph,
  ImpactNode,
  ImpactEdge,
  ImpactLevel,
  ChangeClassification,
  ImpactReason,
  ImpactNodeType,
  ImpactEdgeRelation,
  RequirementImpact,
  ImpactSummary,
} from './models.js';

// ---- Impact Graph Builder -------------------------------------------------

export class ImpactGraphBuilder {
  private nodes: ImpactNode[] = [];
  private edges: ImpactEdge[] = [];
  private nodeMap: Map<string, ImpactNode> = new Map();
  private requirementImpacts: Map<string, RequirementImpact> = new Map();

  constructor(
    private readonly baseRevisionId: string,
    private readonly targetRevisionId: string,
    private readonly baseFingerprint?: string,
    private readonly targetFingerprint?: string,
  ) {}

  // ---- Node Operations ----------------------------------------------------

  /**
   * Add a node to the graph.
   */
  addNode(
    id: string,
    type: ImpactNodeType,
    label: string,
    changeClassification: ChangeClassification,
    impactLevel: ImpactLevel,
    impactReasons: ImpactReason[],
    data?: unknown,
  ): void {
    if (this.nodeMap.has(id)) {
      // Update existing node
      const existing = this.nodeMap.get(id)!;
      existing.changeClassification = changeClassification;
      existing.impactLevel = impactLevel;
      existing.impactReasons = [...new Set([...existing.impactReasons, ...impactReasons])];
      return;
    }

    const node: ImpactNode = {
      id,
      type,
      label,
      changeClassification,
      impactLevel,
      impactReasons,
      data,
    };
    this.nodes.push(node);
    this.nodeMap.set(id, node);
  }

  /**
   * Add an edge to the graph.
   */
  addEdge(
    from: string,
    to: string,
    relation: ImpactEdgeRelation,
    reason?: ImpactReason,
  ): void {
    // Avoid duplicate edges
    const edgeKey = `${from}:${to}:${relation}`;
    const existingEdge = this.edges.find(
      (e) => `${e.from}:${e.to}:${e.relation}` === edgeKey,
    );
    if (!existingEdge) {
      this.edges.push({ from, to, relation, reason });
    }
  }

  /**
   * Get a node by ID.
   */
  getNode(id: string): ImpactNode | undefined {
    return this.nodeMap.get(id);
  }

  /**
   * Get all nodes.
   */
  getNodes(): ImpactNode[] {
    return [...this.nodes];
  }

  /**
   * Get all edges.
   */
  getEdges(): ImpactEdge[] {
    return [...this.edges];
  }

  /**
   * Get nodes by type.
   */
  getNodesByType(type: ImpactNodeType): ImpactNode[] {
    return this.nodes.filter((n) => n.type === type);
  }

  /**
   * Get nodes by impact level.
   */
  getNodesByImpactLevel(level: ImpactLevel): ImpactNode[] {
    return this.nodes.filter((n) => n.impactLevel === level);
  }

  /**
   * Get outgoing edges from a node.
   */
  getOutgoingEdges(nodeId: string): ImpactEdge[] {
    return this.edges.filter((e) => e.from === nodeId);
  }

  /**
   * Get incoming edges to a node.
   */
  getIncomingEdges(nodeId: string): ImpactEdge[] {
    return this.edges.filter((e) => e.to === nodeId);
  }

  /**
   * Get transitive dependencies of a node.
   */
  getTransitiveDependencies(nodeId: string, maxDepth = 10): string[] {
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
    const result: string[] = [];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);

      const outgoingEdges = this.getOutgoingEdges(id);
      for (const edge of outgoingEdges) {
        if (!visited.has(edge.to)) {
          result.push(edge.to);
          queue.push({ id: edge.to, depth: depth + 1 });
        }
      }
    }

    return result;
  }

  /**
   * Check if a node is part of a cycle.
   */
  isPartOfCycle(nodeId: string): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const dfs = (current: string): boolean => {
      visited.add(current);
      recursionStack.add(current);

      const outgoingEdges = this.getOutgoingEdges(current);
      for (const edge of outgoingEdges) {
        if (!visited.has(edge.to)) {
          if (dfs(edge.to)) {
            return true;
          }
        } else if (recursionStack.has(edge.to)) {
          return true;
        }
      }

      recursionStack.delete(current);
      return false;
    };

    return dfs(nodeId);
  }

  // ---- Impact Analysis ----------------------------------------------------

  /**
   * Compute impact summary.
   */
  computeSummary(): ImpactSummary {
    const requirementNodes = this.getNodesByType('requirement');
    const summary: ImpactSummary = {
      changedArtifacts: this.getNodesByType('artifact').filter(
        (n) => n.changeClassification !== 'unchanged',
      ).length,
      changedContexts: this.getNodesByType('context').filter(
        (n) => n.changeClassification !== 'unchanged',
      ).length,
      changedSemanticObjects: this.getNodesByType('semantic-object').filter(
        (n) => n.changeClassification !== 'unchanged',
      ).length,
      totalRequirements: requirementNodes.length,
      unchangedRequirements: requirementNodes.filter(
        (n) => n.impactLevel === 'unchanged',
      ).length,
      directImpacts: requirementNodes.filter(
        (n) => n.impactLevel === 'direct',
      ).length,
      transitiveImpacts: requirementNodes.filter(
        (n) => n.impactLevel === 'transitive',
      ).length,
      unknownImpacts: requirementNodes.filter(
        (n) => n.impactLevel === 'unknown',
      ).length,
      addedRequirements: requirementNodes.filter(
        (n) => n.changeClassification === 'added',
      ).length,
      removedRequirements: requirementNodes.filter(
        (n) => n.changeClassification === 'removed',
      ).length,
    };
    return summary;
  }

  /**
   * Compute requirement impacts.
   */
  computeRequirementImpacts(): Map<string, RequirementImpact> {
    const requirementNodes = this.getNodesByType('requirement');
    for (const node of requirementNodes) {
      const impact: RequirementImpact = {
        requirementId: node.id,
        impactLevel: node.impactLevel,
        impactReasons: node.impactReasons,
        impactPath: this.getImpactPath(node.id),
        needsReplanning: node.impactLevel !== 'unchanged',
      };
      this.requirementImpacts.set(node.id, impact);
    }
    return this.requirementImpacts;
  }

  /**
   * Get the impact path for a requirement.
   */
  private getImpactPath(requirementId: string): string[] {
    const path: string[] = [requirementId];
    const incomingEdges = this.getIncomingEdges(requirementId);
    for (const edge of incomingEdges) {
      if (edge.relation === 'depends-on' || edge.relation === 'requires') {
        path.unshift(edge.from);
      }
    }
    return path;
  }

  // ---- Build Graph --------------------------------------------------------

  /**
   * Build the complete impact graph.
   */
  build(): ImpactGraph {
    const summary = this.computeSummary();
    const requirementImpacts = this.computeRequirementImpacts();

    return {
      schemaVersion: '1.0',
      baseRevisionId: this.baseRevisionId,
      targetRevisionId: this.targetRevisionId,
      baseFingerprint: this.baseFingerprint,
      targetFingerprint: this.targetFingerprint,
      nodes: this.nodes,
      edges: this.edges,
      summary,
      requirementImpacts,
    };
  }
}

// ---- Utility Functions ----------------------------------------------------

/**
 * Generate a stable ID for an impact node.
 */
export function generateImpactNodeId(
  type: ImpactNodeType,
  identifier: string,
): string {
  return `${type}:${identifier}`;
}

/**
 * Compute content fingerprint for comparison.
 */
export function computeFingerprint(data: unknown): string {
  return sha256(canonicalJson(data));
}
