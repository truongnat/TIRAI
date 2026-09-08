import { CONTRACT_SCHEMA_VERSION } from './models.js';

export const contractIRSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://tirai.dev/schemas/contract-ir-1.0.json',
  title: 'TIRAI Contract IR',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion', 'contractId', 'contractVersion', 'project', 'document',
    'sources', 'rawContexts', 'requirements', 'businessFlows', 'ui', 'apis',
    'entities', 'modules', 'scenarios', 'testCases', 'artifacts', 'unresolved',
    'conflicts', 'quality', 'metadata',
  ],
  properties: {
    schemaVersion: { const: CONTRACT_SCHEMA_VERSION },
    contractId: { type: 'string', minLength: 1 },
    contractVersion: { type: 'integer', minimum: 1 },
    project: {
      type: 'object', additionalProperties: false, required: ['id', 'name'],
      properties: { id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, profileFingerprint: { type: 'string' } },
    },
    document: {
      type: 'object', additionalProperties: false, required: ['title'],
      properties: { title: { type: 'string', minLength: 1 }, summary: { type: 'string' }, language: { type: 'array', items: { type: 'string' } } },
    },
    sources: { type: 'array', items: { $ref: '#/$defs/source' } },
    rawContexts: { type: 'array', items: { $ref: '#/$defs/rawContext' } },
    requirements: { type: 'array', items: { $ref: '#/$defs/node' } },
    businessFlows: { type: 'array', items: { $ref: '#/$defs/node' } },
    ui: { type: 'array', items: { $ref: '#/$defs/node' } },
    apis: { type: 'array', items: { $ref: '#/$defs/node' } },
    entities: { type: 'array', items: { $ref: '#/$defs/node' } },
    modules: { type: 'array', items: { $ref: '#/$defs/node' } },
    scenarios: { type: 'array', items: { $ref: '#/$defs/node' } },
    testCases: { type: 'array', items: { $ref: '#/$defs/node' } },
    artifacts: { type: 'array', items: { $ref: '#/$defs/node' } },
    unresolved: { type: 'array', items: { $ref: '#/$defs/unresolved' } },
    conflicts: { type: 'array', items: { $ref: '#/$defs/conflict' } },
    quality: { type: 'object', additionalProperties: false, required: ['requirements', 'requirementsCovered', 'scenarios', 'testCases', 'automationReady', 'unresolved', 'conflicts', 'provenanceCoverage'], properties: {
      requirements: { type: 'integer', minimum: 0 }, requirementsCovered: { type: 'integer', minimum: 0 }, scenarios: { type: 'integer', minimum: 0 }, testCases: { type: 'integer', minimum: 0 }, automationReady: { type: 'integer', minimum: 0 }, unresolved: { type: 'integer', minimum: 0 }, conflicts: { type: 'integer', minimum: 0 }, provenanceCoverage: { type: 'number', minimum: 0, maximum: 1 },
    } },
    metadata: { type: 'object', additionalProperties: false, required: ['contractFingerprint', 'generatedAt', 'generatorVersion', 'promptVersions'], properties: { contractFingerprint: { type: 'string', minLength: 1 }, generatedAt: { type: 'string', minLength: 1 }, generatorVersion: { type: 'string', minLength: 1 }, aiProvider: { type: 'string' }, aiModel: { type: 'string' }, promptVersions: { type: 'array', items: { type: 'string' } } } },
  },
  $defs: {
    source: { type: 'object', required: ['id', 'kind', 'displayName', 'contentHash', 'provenance'], properties: { id: { type: 'string' }, kind: { type: 'string' }, displayName: { type: 'string' }, contentHash: { type: 'string' }, pathOrUri: { type: 'string' }, provenance: { type: 'array' } } },
    rawContext: { type: 'object', required: ['id', 'sourceId', 'kind', 'contentHash', 'content', 'provenance'], properties: { id: { type: 'string' }, sourceId: { type: 'string' }, title: { type: 'string' }, kind: { type: 'string' }, parentContextId: { type: 'string' }, contentHash: { type: 'string' }, locator: { type: 'string' }, content: { type: 'string' }, provenance: { type: 'array' } } },
    node: { type: 'object', required: ['id', 'kind', 'title', 'relatedIds', 'provenance', 'confidence'], properties: { id: { type: 'string' }, kind: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, relatedIds: { type: 'array', items: { type: 'string' } }, provenance: { type: 'array' }, confidence: { type: 'number', minimum: 0, maximum: 1 } } },
    unresolved: { type: 'object', required: ['id', 'description', 'reason', 'relatedIds', 'provenance', 'confidence'], properties: { id: { type: 'string' }, description: { type: 'string' }, reason: { type: 'string' }, relatedIds: { type: 'array' }, provenance: { type: 'array' }, confidence: { type: 'number' } } },
    conflict: { type: 'object', required: ['id', 'description', 'type', 'relatedIds', 'provenance', 'confidence'], properties: { id: { type: 'string' }, description: { type: 'string' }, type: { type: 'string' }, relatedIds: { type: 'array' }, provenance: { type: 'array' }, confidence: { type: 'number' } } },
  },
} as const;
