// ---------------------------------------------------------------------------
// Semantic IR – canonical data model
// ---------------------------------------------------------------------------
// Source-independent, provider-independent, domain-flexible.
// Excel terminology appears only in provenance references.

// ---- Top-level IR --------------------------------------------------------

export interface SemanticIR {
  schemaVersion: '1.0';
  document: SemanticDocument;
  sections: SemanticSection[];
  entities: SemanticEntity[];
  flows: SemanticFlow[];
  rules: SemanticRule[];
  relationships: SemanticRelationship[];
  unresolved: SemanticUnresolved[];
  analysis: SemanticAnalysisMetadata;
}

// ---- Document ------------------------------------------------------------

export interface SemanticDocument {
  title?: string;
  summary?: string;
  language?: string[];
  domainHints?: string[];
  provenance: ProvenanceReference[];
}

// ---- Section -------------------------------------------------------------

export interface SemanticSection {
  id: string;
  title: string;
  description?: string;
  type?: string;
  parentId?: string;
  provenance: ProvenanceReference[];
  confidence: number;
}

// ---- Entity --------------------------------------------------------------

export interface SemanticEntity {
  id: string;
  name: string;
  type: string;
  description?: string;
  attributes?: SemanticAttribute[];
  aliases?: string[];
  provenance: ProvenanceReference[];
  confidence: number;
}

// ---- Attribute -----------------------------------------------------------

export interface SemanticAttribute {
  name: string;
  value?: unknown;
  dataType?: string;
  description?: string;
  provenance?: ProvenanceReference[];
}

// ---- Flow ----------------------------------------------------------------

export interface SemanticFlow {
  id: string;
  name: string;
  description?: string;
  actors?: string[];
  steps: SemanticFlowStep[];
  preconditions?: string[];
  postconditions?: string[];
  provenance: ProvenanceReference[];
  confidence: number;
}

export interface SemanticFlowStep {
  order: number;
  action: string;
  actor?: string;
  target?: string;
  condition?: string;
  outcome?: string;
  provenance: ProvenanceReference[];
}

// ---- Rule ----------------------------------------------------------------

export interface SemanticRule {
  id: string;
  type: string;
  statement: string;
  conditions?: SemanticCondition[];
  effects?: SemanticEffect[];
  relatedEntityIds?: string[];
  provenance: ProvenanceReference[];
  confidence: number;
}

// ---- Condition -----------------------------------------------------------

export interface SemanticCondition {
  expression: string;
  operands?: string[];
  provenance?: ProvenanceReference[];
}

// ---- Effect --------------------------------------------------------------

export interface SemanticEffect {
  description: string;
  target?: string;
  value?: unknown;
  provenance?: ProvenanceReference[];
}

// ---- Relationship --------------------------------------------------------

export interface SemanticRelationship {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
  description?: string;
  provenance: ProvenanceReference[];
  confidence: number;
}

// ---- Unresolved ----------------------------------------------------------

export interface SemanticUnresolved {
  id: string;
  type: string;
  description: string;
  candidates?: string[];
  provenance: ProvenanceReference[];
  reason: string;
}

// ---- Provenance ----------------------------------------------------------

export interface ProvenanceReference {
  contextId: string;
  sheet?: string;
  ranges?: string[];
  cells?: string[];
}

// ---- Analysis metadata ---------------------------------------------------

export interface SemanticAnalysisMetadata {
  provider: string;
  model: string;
  promptVersion: string;
  chunksAnalyzed: number;
  aiRequests: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  warnings: SemanticWarning[];
}

// ---- Warning model -------------------------------------------------------

export interface SemanticWarning {
  code: string;
  message: string;
  contextId?: string;
  objectId?: string;
}

// ---- Chunk-level AI result (Pass 1 output) -------------------------------

export interface ChunkSemanticResult {
  contextId: string;
  sections: ChunkSection[];
  entities: ChunkEntity[];
  flows: ChunkFlow[];
  rules: ChunkRule[];
  relationships: ChunkRelationship[];
  unresolved: ChunkUnresolved[];
}

// Chunk-level types use local IDs; global merge assigns final IDs.

export interface ChunkSection {
  localId: string;
  title: string;
  description?: string;
  type?: string;
  provenance: ProvenanceReference[];
  confidence: number;
}

export interface ChunkEntity {
  localId: string;
  name: string;
  type: string;
  description?: string;
  attributes?: SemanticAttribute[];
  aliases?: string[];
  provenance: ProvenanceReference[];
  confidence: number;
}

export interface ChunkFlow {
  localId: string;
  name: string;
  description?: string;
  actors?: string[];
  steps: SemanticFlowStep[];
  preconditions?: string[];
  postconditions?: string[];
  provenance: ProvenanceReference[];
  confidence: number;
}

export interface ChunkRule {
  localId: string;
  type: string;
  statement: string;
  conditions?: SemanticCondition[];
  effects?: SemanticEffect[];
  provenance: ProvenanceReference[];
  confidence: number;
}

export interface ChunkRelationship {
  localId: string;
  type: string;
  sourceLocalId: string;
  targetLocalId: string;
  description?: string;
  provenance: ProvenanceReference[];
  confidence: number;
}

export interface ChunkUnresolved {
  localId: string;
  type: string;
  description: string;
  candidates?: string[];
  provenance: ProvenanceReference[];
  reason: string;
}

// ---- Consolidation result (Pass 2 output) --------------------------------

export interface ConsolidationResult {
  mergeCandidates: MergeCandidate[];
  crossChunkRelationships: ChunkRelationship[];
  documentSummary?: {
    title?: string;
    summary?: string;
    language?: string[];
    domainHints?: string[];
  };
}

export interface MergeCandidate {
  sourceLocalIds: string[];
  reason: string;
  confidence: number;
}

// ---- Analyzer options ----------------------------------------------------

export interface SemanticAnalyzerOptions {
  /** Output directory for intermediate analysis files. */
  outputDir?: string;
  /** Concurrency for chunk analysis (default: 2). */
  concurrency?: number;
  /** Resume from existing intermediate results. */
  resume?: boolean;
  /** Prompt version override. */
  promptVersion?: string;
  /** Specific sheets to analyze. */
  sheets?: string[];
}

// ---- Analysis manifest ---------------------------------------------------

export interface AnalysisManifest {
  schemaVersion: '1.0';
  source: {
    contextManifest: string;
  };
  provider: {
    name: string;
    model: string;
  };
  promptVersion: string;
  stats: {
    chunks: number;
    aiRequests: number;
    entities: number;
    sections: number;
    flows: number;
    rules: number;
    relationships: number;
    unresolved: number;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  warnings: SemanticWarning[];
}
