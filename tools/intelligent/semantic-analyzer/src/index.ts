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
  SemanticExecutionMetrics,
} from './models.js';

export { SemanticAnalyzerError, SemanticErrorCode } from './errors.js';
export { SemanticWarningCode, CONFIDENCE_THRESHOLD } from './warnings.js';
export { PROMPT_VERSION, SEMANTIC_SYSTEM_PROMPT } from './prompts/system.js';
export {
  DEFAULT_SEMANTIC_BUDGET,
  SEMANTIC_INPUT_BUDGET_EXCEEDED,
  SEMANTIC_REQUEST_LIMIT_EXCEEDED,
  estimateRequestTokens,
  estimateTokens,
} from './budget.js';
export type { SemanticAnalyzerBudget } from './budget.js';
export { preflightSemanticContext, preflightLoadedContext } from './preflight.js';
export type { SemanticPreflightReport } from './preflight.js';
