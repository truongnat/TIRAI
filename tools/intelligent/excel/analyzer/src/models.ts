// ---------------------------------------------------------------------------
// Semantic IR – output contract for AI Analyzer v1
// ---------------------------------------------------------------------------
// This schema represents the AI's understanding of the Excel spec.
// It does NOT generate test cases or requirements – only semantic extraction.

// ---- Top-level -----------------------------------------------------------

export interface SemanticIR {
  schemaVersion: '1.0';
  source: SemanticSource;
  entities: Entity[];
  sections: Section[];
  flows: Flow[];
  fields: Field[];
  rules: Rule[];
  relationships: Relationship[];
  provenance: SemanticProvenance[];
  warnings: AnalyzerWarning[];
}

export interface SemanticSource {
  file: string;
  sheets: number;
  chunks: number;
  analyzedAt: string; // ISO-8601, deterministic: always "N/A" for v1
  provider: string;   // e.g. "gemini-2.5-flash"
}

// ---- Entity --------------------------------------------------------------
// A named concept: screen, module, table, API, component, role, etc.

export type EntityType =
  | 'screen'        // UI màn hình
  | 'module'        // FE module
  | 'table'         // DB table
  | 'api'           // API endpoint
  | 'component'     // UI component
  | 'role'          // User role
  | 'business-flow' // Business process
  | 'config'        // Configuration
  | 'data-entity'   // Abstract data entity
  | 'unknown';

export interface Entity {
  id: string;               // deterministic: ent-{type}-{NNN}
  name: string;             // display name
  type: EntityType;
  description: string | null;
  sourceSheet: string;      // sheet name
  sourceRange: string | null;
  metadata: Record<string, string>;
}

// ---- Section -------------------------------------------------------------
// A logical grouping within a sheet (e.g., a table header + its rows)

export interface Section {
  id: string;               // deterministic: sec-{sheetIndex}-{NNN}
  name: string;
  sheetName: string;
  range: string | null;
  purpose: string | null;   // what this section represents
  entityIds: string[];      // entities found in this section
}

// ---- Flow ----------------------------------------------------------------
// A step in a business process

export interface Flow {
  id: string;               // deterministic: flow-{NNN}
  name: string;
  description: string | null;
  sheetName: string;
  steps: FlowStep[];
  sourceRange: string | null;
}

export interface FlowStep {
  order: number;
  name: string;
  description: string | null;
  input: string | null;
  output: string | null;
  branchCondition: string | null;
  nextSteps: string[];      // flow step IDs or "END"
}

// ---- Field ---------------------------------------------------------------
// A data field with type and constraints

export interface Field {
  id: string;               // deterministic: field-{tableName}-{columnName} or field-{NNN}
  name: string;
  entityType: string | null; // which entity this field belongs to
  dataType: string | null;
  required: boolean;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isUnique: boolean;
  defaultValue: string | null;
  description: string | null;
  constraints: string[];
  sourceSheet: string;
  sourceCell: string | null;
}

// ---- Rule ----------------------------------------------------------------
// A business or validation rule extracted from the spec

export type RuleType =
  | 'validation'     // data validation
  | 'business'       // business logic
  | 'conditional'    // conditional branching
  | 'constraint'     // data constraint
  | 'format'         // format rule
  | 'unknown';

export interface Rule {
  id: string;               // deterministic: rule-{NNN}
  name: string | null;
  type: RuleType;
  description: string;
  condition: string | null;
  action: string | null;
  sourceSheet: string;
  sourceRange: string | null;
}

// ---- Relationship --------------------------------------------------------
// Connection between entities

export type RelationshipType =
  | 'uses-api'        // screen/module uses an API
  | 'has-field'       // entity has a field
  | 'references'      // entity references another
  | 'flows-to'        // flow leads to another
  | 'parent-child'    // hierarchical
  | 'implements'      // module implements entity
  | 'depends-on'      // dependency
  | 'related';        // generic

export interface Relationship {
  id: string;               // deterministic: rel-{NNN}
  type: RelationshipType;
  fromEntityId: string;
  toEntityId: string;
  description: string | null;
  sourceSheet: string | null;
  sourceRange: string | null;
}

// ---- Provenance ----------------------------------------------------------

export interface SemanticProvenance {
  irElement: string;        // ID of the IR element
  irType: 'entity' | 'section' | 'flow' | 'field' | 'rule' | 'relationship';
  chunkId: string;          // source chunk ID
  sheetName: string;
  range: string | null;
}

// ---- Warnings ------------------------------------------------------------

export interface AnalyzerWarning {
  code: string;
  message: string;
  sheet?: string;
}

// ---- Analyzer options ----------------------------------------------------

export interface AnalyzerOptions {
  /** AI provider: 'gemini' (default). */
  provider?: 'gemini';
  /** Gemini model name. */
  model?: string;
  /** Gemini API key (or set GEMINI_API_KEY env). */
  apiKey?: string;
  /** Max tokens for AI response. */
  maxOutputTokens?: number;
  /** Only analyze specific sheets. */
  sheets?: string[];
}
