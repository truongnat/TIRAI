// ---------------------------------------------------------------------------
// Test Data Planner – JSON schemas for AI responses
// ---------------------------------------------------------------------------

import type { JSONSchema } from 'ai-provider';

const provenanceSchema = {
  type: 'object',
  properties: {
    requirementId: { type: 'string' },
    contextId: { type: 'string' },
    sheet: { type: 'string' },
    ranges: { type: 'array', items: { type: 'string' } },
  },
  required: ['requirementId'],
  additionalProperties: false,
} as const;

const provenanceArray = {
  type: 'array',
  items: provenanceSchema,
} as const;

// ---- Data requirement extraction schema -----------------------------------

const constraintCandidateSchema = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    field: { type: 'string' },
    operator: { type: 'string' },
    value: {},
    description: { type: 'string' },
  },
  required: ['type', 'description'],
  additionalProperties: false,
} as const;

const dataRequirementCandidateSchema = {
  type: 'object',
  properties: {
    temporaryId: { type: 'string' },
    testCaseId: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    type: { type: 'string' },
    lifecycle: { type: 'string' },
    strategy: { type: 'string' },
    constraints: { type: 'array', items: constraintCandidateSchema },
    relatedRequirementIds: { type: 'array', items: { type: 'string' } },
    relatedEntityIds: { type: 'array', items: { type: 'string' } },
    provenance: provenanceArray,
    confidence: { type: 'number' },
  },
  required: [
    'temporaryId', 'testCaseId', 'name', 'description', 'type',
    'lifecycle', 'strategy', 'constraints', 'relatedRequirementIds',
    'provenance', 'confidence',
  ],
  additionalProperties: false,
} as const;

const dataUnresolvedSchema = {
  type: 'object',
  properties: {
    testCaseIds: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
    reason: { type: 'string' },
    provenance: provenanceArray,
  },
  required: ['testCaseIds', 'description', 'reason', 'provenance'],
  additionalProperties: false,
} as const;

/** JSON Schema for data requirement extraction AI response. */
export const dataRequirementExtractionSchema: JSONSchema = {
  type: 'object',
  properties: {
    dataCandidates: { type: 'array', items: dataRequirementCandidateSchema },
    unresolvedCandidates: { type: 'array', items: dataUnresolvedSchema },
  },
  required: ['dataCandidates', 'unresolvedCandidates'],
  additionalProperties: false,
};

// ---- Dependency analysis schema -------------------------------------------

const dependencyCandidateSchema = {
  type: 'object',
  properties: {
    sourceTemporaryId: { type: 'string' },
    targetTemporaryId: { type: 'string' },
    type: { type: 'string' },
    description: { type: 'string' },
  },
  required: ['sourceTemporaryId', 'targetTemporaryId', 'type'],
  additionalProperties: false,
} as const;

const reuseCandidateSchema = {
  type: 'object',
  properties: {
    temporaryIds: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
    reusePolicy: { type: 'string' },
  },
  required: ['temporaryIds', 'reason', 'reusePolicy'],
  additionalProperties: false,
} as const;

/** JSON Schema for dependency analysis AI response. */
export const dependencyAnalysisSchema: JSONSchema = {
  type: 'object',
  properties: {
    dependencyCandidates: { type: 'array', items: dependencyCandidateSchema },
    reuseCandidates: { type: 'array', items: reuseCandidateSchema },
  },
  required: ['dependencyCandidates', 'reuseCandidates'],
  additionalProperties: false,
};
