// ---------------------------------------------------------------------------
// Semantic Analyzer – public API (type shell)
// ---------------------------------------------------------------------------
// TIRAI is a pure tool: semantic analysis is supplied by the host agent.
// This package retains the canonical Semantic IR model only.

export type {
  SemanticIR,
  SemanticCompletionStatus,
  SemanticDocument,
  SemanticSection,
  SemanticEntity,
  SemanticAttribute,
  SemanticFlow,
  SemanticFlowStep,
  SemanticRule,
  SemanticCondition,
  SemanticEffect,
  SemanticRelationship,
  SemanticUnresolved,
  ProvenanceReference,
  SemanticWarning,
  SemanticAnalysisMetadata,
} from './models.js';
