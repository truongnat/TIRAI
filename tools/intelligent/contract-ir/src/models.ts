export const CONTRACT_SCHEMA_VERSION = '1.0' as const;
export type ContractSchemaVersion = typeof CONTRACT_SCHEMA_VERSION;

export type ContractNodeKind =
  | 'requirement'
  | 'business-flow'
  | 'ui'
  | 'api'
  | 'entity'
  | 'module'
  | 'scenario'
  | 'test-case'
  | 'artifact';

export interface ContractProvenance {
  sourceId: string;
  contextId?: string;
  locator?: string;
  sheet?: string;
  ranges?: string[];
  cells?: string[];
  confidence?: number;
}

export interface ContractSource {
  id: string;
  kind: 'excel' | 'pdf' | 'docx' | 'markdown' | 'html' | 'json' | 'csv' | 'url' | 'source-code' | 'other';
  displayName: string;
  contentHash: string;
  pathOrUri?: string;
  provenance: ContractProvenance[];
}

export interface ContractRawContext {
  id: string;
  sourceId: string;
  title?: string;
  kind: 'document' | 'sheet' | 'page' | 'section' | 'table' | 'module' | 'file' | 'chunk';
  parentContextId?: string;
  contentHash: string;
  locator?: string;
  content: string;
  provenance: ContractProvenance[];
}

export interface ContractNode {
  id: string;
  kind: ContractNodeKind;
  title: string;
  description?: string;
  relatedIds: string[];
  provenance: ContractProvenance[];
  confidence: number;
}

export interface ContractRequirement extends ContractNode {
  kind: 'requirement';
  type: string;
  statement: string;
  actor?: string;
  trigger?: string;
  preconditions: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  testability: 'testable' | 'partially-testable' | 'not-testable' | 'unknown';
}

export interface ContractBusinessFlow extends ContractNode {
  kind: 'business-flow';
  steps: string[];
  inputs: string[];
  outputs: string[];
  branches: string[];
}

export interface ContractUIElement extends ContractNode {
  kind: 'ui';
  route?: string;
  locator?: string;
  actions: string[];
  states: string[];
}

export interface ContractAPI extends ContractNode {
  kind: 'api';
  method: string;
  endpoint: string;
  request?: unknown;
  successResponse?: unknown;
  errorResponses: unknown[];
}

export interface ContractEntity extends ContractNode {
  kind: 'entity';
  attributes: Array<{ name: string; dataType?: string; required?: boolean; constraints: string[] }>;
}

export interface ContractModule extends ContractNode {
  kind: 'module';
  sourceFiles: string[];
  dependencies: string[];
  state: string[];
}

export interface ContractScenario extends ContractNode {
  kind: 'scenario';
  requirementIds: string[];
  category: string;
  preconditions: string[];
  expectedBehaviors: string[];
}

export interface ContractTestCase extends ContractNode {
  kind: 'test-case';
  scenarioId: string;
  requirementIds: string[];
  executor: 'playwright' | 'unit' | 'api' | 'database' | 'manual' | 'hybrid';
  priority: 'critical' | 'high' | 'medium' | 'low';
  preconditions: string[];
  dataNeeds: string[];
  steps: Array<{ order: number; action: string; target?: string; input?: string }>;
  assertions: Array<{ description: string; type: string; target?: string; expected?: unknown }>;
  cleanup: string[];
  automation: 'ready' | 'partially-ready' | 'manual-only' | 'unknown';
}

export interface ContractArtifact extends ContractNode {
  kind: 'artifact';
  artifactType: 'excel' | 'markdown' | 'playwright' | 'unit' | 'api' | 'database' | 'json' | 'report';
  path: string;
  module?: string;
  dependsOn: string[];
  contractIds: string[];
  status: 'planned' | 'generated' | 'executed' | 'failed';
}

export interface ContractUnresolved {
  id: string;
  description: string;
  reason: string;
  relatedIds: string[];
  provenance: ContractProvenance[];
  confidence: number;
}

export interface ContractConflict {
  id: string;
  description: string;
  type: 'contradiction' | 'ambiguous' | 'inconsistent-constraint' | 'potential-overlap';
  relatedIds: string[];
  provenance: ContractProvenance[];
  confidence: number;
}

export interface ContractQuality {
  requirements: number;
  requirementsCovered: number;
  scenarios: number;
  testCases: number;
  automationReady: number;
  unresolved: number;
  conflicts: number;
  provenanceCoverage: number;
}

export interface ContractMetadata {
  contractFingerprint: string;
  generatedAt: string;
  generatorVersion: string;
  aiProvider?: string;
  aiModel?: string;
  promptVersions: string[];
}

export interface ContractExecutionContext {
  api?: {
    resourceMappings: Array<{ id: string; baseUrl?: string; path?: string; approved?: boolean }>;
    secretRefs?: string[];
    allowMutations?: boolean;
  };
  database?: {
    queryMappings: Array<{ id: string; query: string; readOnly: boolean; approved: boolean }>;
    secretRefs?: string[];
  };
}

export interface ContractIR {
  schemaVersion: ContractSchemaVersion;
  contractId: string;
  contractVersion: number;
  project: { id: string; name: string; profileFingerprint?: string };
  document: { title: string; summary?: string; language?: string[] };
  sources: ContractSource[];
  rawContexts: ContractRawContext[];
  requirements: ContractRequirement[];
  businessFlows: ContractBusinessFlow[];
  ui: ContractUIElement[];
  apis: ContractAPI[];
  entities: ContractEntity[];
  modules: ContractModule[];
  scenarios: ContractScenario[];
  testCases: ContractTestCase[];
  artifacts: ContractArtifact[];
  unresolved: ContractUnresolved[];
  conflicts: ContractConflict[];
  quality: ContractQuality;
  metadata: ContractMetadata;
  executionContext?: ContractExecutionContext;
}
