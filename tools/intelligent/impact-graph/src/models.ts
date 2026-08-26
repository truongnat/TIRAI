// ---------------------------------------------------------------------------
// Impact Graph Models — Semantic impact analysis for incremental planning
// ---------------------------------------------------------------------------
// Represents the impact graph between changes, artifacts, semantic objects,
// requirements, scenarios, and test cases.

import type { SemanticIR, SemanticEntity, SemanticRule, SemanticRelationship } from 'semantic-analyzer';
import type { Requirement } from 'requirement-builder';

// ---- Impact Classification ------------------------------------------------

export type ImpactLevel = 'unchanged' | 'direct' | 'transitive' | 'unknown' | 'added' | 'removed';

export type ChangeClassification = 'unchanged' | 'added' | 'removed' | 'modified' | 'moved' | 'unknown';

export type ImpactReason =
  | 'direct-provenance'
  | 'direct-semantic-reference'
  | 'shared-constraint'
  | 'shared-entity'
  | 'dependency-edge'
  | 'transitive-dependency'
  | 'added-requirement'
  | 'removed-requirement'
  | 'ambiguous-dependency'
  | 'unknown-blast-radius';

// ---- Impact Graph Nodes ---------------------------------------------------

export type ImpactNodeType =
  | 'change'
  | 'artifact'
  | 'context'
  | 'semantic-object'
  | 'requirement'
  | 'scenario'
  | 'test-case';

export interface ImpactNode {
  /** Stable identity key (content-hash or semantic ID). */
  id: string;
  /** Type of node. */
  type: ImpactNodeType;
  /** Human-readable label. */
  label: string;
  /** Classification of change for this node. */
  changeClassification: ChangeClassification;
  /** Impact level for this node. */
  impactLevel: ImpactLevel;
  /** Reasons for this impact decision. */
  impactReasons: ImpactReason[];
  /** Revision fingerprint at time of analysis. */
  revisionFingerprint?: string;
  /** Source data (optional). */
  data?: unknown;
}

// ---- Impact Graph Edges ---------------------------------------------------

export type ImpactEdgeRelation =
  | 'causes'
  | 'depends-on'
  | 'requires'
  | 'covers'
  | 'implements'
  | 'related-to';

export interface ImpactEdge {
  /** Source node ID. */
  from: string;
  /** Target node ID. */
  to: string;
  /** Relationship type. */
  relation: ImpactEdgeRelation;
  /** Reason for this edge. */
  reason?: ImpactReason;
}

// ---- Impact Graph ---------------------------------------------------------

export interface ImpactGraph {
  /** Schema version. */
  schemaVersion: '1.0';
  /** Base revision ID. */
  baseRevisionId: string;
  /** Target revision ID. */
  targetRevisionId: string;
  /** Base revision fingerprint. */
  baseFingerprint?: string;
  /** Target revision fingerprint. */
  targetFingerprint?: string;
  /** All nodes in the graph. */
  nodes: ImpactNode[];
  /** All edges in the graph. */
  edges: ImpactEdge[];
  /** Impact summary. */
  summary: ImpactSummary;
  /** Impact reasons for each requirement. */
  requirementImpacts: Map<string, RequirementImpact>;
}

// ---- Impact Summary -------------------------------------------------------

export interface ImpactSummary {
  /** Total number of changed artifacts. */
  changedArtifacts: number;
  /** Total number of changed contexts. */
  changedContexts: number;
  /** Total number of changed semantic objects. */
  changedSemanticObjects: number;
  /** Total number of requirements. */
  totalRequirements: number;
  /** Number of unchanged requirements. */
  unchangedRequirements: number;
  /** Number of directly impacted requirements. */
  directImpacts: number;
  /** Number of transitively impacted requirements. */
  transitiveImpacts: number;
  /** Number of unknown impact requirements. */
  unknownImpacts: number;
  /** Number of added requirements. */
  addedRequirements: number;
  /** Number of removed requirements. */
  removedRequirements: number;
}

// ---- Requirement Impact ---------------------------------------------------

export interface RequirementImpact {
  /** Requirement ID. */
  requirementId: string;
  /** Impact level. */
  impactLevel: ImpactLevel;
  /** Reasons for this impact. */
  impactReasons: ImpactReason[];
  /** Path of nodes explaining the impact. */
  impactPath: string[];
  /** Whether this requirement needs replanning. */
  needsReplanning: boolean;
}

// ---- Incremental Planning Input -------------------------------------------

export interface IncrementalPlanningRequest {
  /** Base revision snapshot. */
  baseRevision: {
    id: string;
    fingerprint?: string;
    semanticIR: SemanticIR;
    requirements: Requirement[];
  };
  /** Target revision snapshot. */
  targetRevision: {
    id: string;
    fingerprint?: string;
    semanticIR: SemanticIR;
    requirements: Requirement[];
  };
  /** Previous test plan (if any). */
  previousTestPlan?: unknown;
}

// ---- Incremental Planning Plan -------------------------------------------

export interface IncrementalPlanningPlan {
  /** Requirements to plan (impacted/added). */
  requirementsToPlan: Requirement[];
  /** Requirements to preserve (unaffected). */
  requirementsToPreserve: Requirement[];
  /** Requirements to remove (removed). */
  requirementsToRemove: Requirement[];
  /** Requirements with unknown impact. */
  requirementsUnknown: Requirement[];
  /** Impact graph for this plan. */
  impactGraph: ImpactGraph;
  /** Whether full replan is required. */
  fullReplanRequired: boolean;
  /** Reason for full replan (if applicable). */
  fullReplanReason?: string;
}

// ---- Merged Planning Result -----------------------------------------------

export interface MergedPlanningResult {
  /** Complete current test plan. */
  testPlan: unknown;
  /** Planning metadata. */
  metadata: {
    /** Whether this is an incremental or full replan. */
    isIncremental: boolean;
    /** Base revision ID. */
    baseRevisionId?: string;
    /** Target revision ID. */
    targetRevisionId?: string;
    /** Number of scenarios preserved. */
    scenariosPreserved: number;
    /** Number of scenarios generated. */
    scenariosGenerated: number;
    /** Number of scenarios removed. */
    scenariosRemoved: number;
    /** Number of test cases preserved. */
    testCasesPreserved: number;
    /** Number of test cases generated. */
    testCasesGenerated: number;
    /** Number of test cases removed. */
    testCasesRemoved: number;
    /** Number of planner AI calls made. */
    plannerCallsMade: number;
    /** Number of planner AI calls avoided. */
    plannerCallsAvoided: number;
    /** Unknown impact expansions. */
    unknownImpactExpansions: number;
    /** Full replan fallbacks. */
    fullReplanFallbacks: number;
  };
}
