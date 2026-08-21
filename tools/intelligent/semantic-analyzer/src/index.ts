// ---------------------------------------------------------------------------
// Semantic Analyzer – public API
// ---------------------------------------------------------------------------

export { analyzeSemanticContext } from './analyzer.js';

export type {
  SemanticIR,
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
  SemanticAnalyzerOptions,
  ChunkSemanticResult,
  ConsolidationResult,
  AnalysisManifest,
} from './models.js';

export { SemanticAnalyzerError, SemanticErrorCode } from './errors.js';
export { SemanticWarningCode, CONFIDENCE_THRESHOLD } from './warnings.js';
export { PROMPT_VERSION, SEMANTIC_SYSTEM_PROMPT } from './prompts/system.js';
