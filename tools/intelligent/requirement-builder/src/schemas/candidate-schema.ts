// ---------------------------------------------------------------------------
// Candidate extraction response schema – sent to AIProvider
// ---------------------------------------------------------------------------

import type { JSONSchema } from 'ai-provider';

const provenanceSchema = {
  type: 'object',
  properties: {
    contextId: { type: 'string' },
    sheet: { type: 'string' },
    ranges: { type: 'array', items: { type: 'string' } },
    cells: { type: 'array', items: { type: 'string' } },
  },
  required: ['contextId'],
  additionalProperties: false,
} as const;

const provenanceArray = {
  type: 'array',
  items: provenanceSchema,
} as const;

const conditionSchema = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    relatedSemanticIds: { type: 'array', items: { type: 'string' } },
    provenance: provenanceArray,
  },
  required: ['description', 'provenance'],
  additionalProperties: false,
} as const;

const inputSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    dataType: { type: 'string' },
    required: { type: 'boolean' },
    constraints: { type: 'array', items: { type: 'string' } },
    relatedSemanticId: { type: 'string' },
    provenance: provenanceArray,
  },
  required: ['name', 'provenance'],
  additionalProperties: false,
} as const;

const behaviorSchema = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    condition: { type: 'string' },
    target: { type: 'string' },
    provenance: provenanceArray,
  },
  required: ['description', 'provenance'],
  additionalProperties: false,
} as const;

const outcomeSchema = {
  type: 'object',
  properties: {
    condition: { type: 'string' },
    description: { type: 'string' },
    state: { type: 'string' },
    provenance: provenanceArray,
  },
  required: ['description', 'provenance'],
  additionalProperties: false,
} as const;

const constraintSchema = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    description: { type: 'string' },
    value: {},
    provenance: provenanceArray,
  },
  required: ['type', 'description', 'provenance'],
  additionalProperties: false,
} as const;

const candidateSchema = {
  type: 'object',
  properties: {
    temporaryId: { type: 'string' },
    title: { type: 'string' },
    type: { type: 'string' },
    statement: { type: 'string' },
    sourceNature: { type: 'string' },
    semanticEvidenceIds: { type: 'array', items: { type: 'string' } },
    actor: { type: 'string' },
    trigger: { type: 'string' },
    preconditions: { type: 'array', items: conditionSchema },
    inputs: { type: 'array', items: inputSchema },
    expectedBehaviors: { type: 'array', items: behaviorSchema },
    outcomes: { type: 'array', items: outcomeSchema },
    constraints: { type: 'array', items: constraintSchema },
    provenance: provenanceArray,
    confidence: { type: 'number' },
    rationale: { type: 'string' },
  },
  required: ['temporaryId', 'title', 'type', 'statement', 'sourceNature', 'semanticEvidenceIds', 'provenance', 'confidence'],
  additionalProperties: false,
} as const;

const unresolvedCandidateSchema = {
  type: 'object',
  properties: {
    temporaryId: { type: 'string' },
    description: { type: 'string' },
    reason: { type: 'string' },
    semanticEvidenceIds: { type: 'array', items: { type: 'string' } },
    provenance: provenanceArray,
    candidates: { type: 'array', items: { type: 'string' } },
  },
  required: ['temporaryId', 'description', 'reason', 'semanticEvidenceIds', 'provenance'],
  additionalProperties: false,
} as const;

const conflictCandidateSchema = {
  type: 'object',
  properties: {
    temporaryId: { type: 'string' },
    requirementTemporaryIds: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
    type: { type: 'string' },
    provenance: provenanceArray,
    confidence: { type: 'number' },
  },
  required: ['temporaryId', 'requirementTemporaryIds', 'description', 'type', 'provenance', 'confidence'],
  additionalProperties: false,
} as const;

/** JSON Schema for the candidate extraction AI response. */
export const candidateExtractionSchema: JSONSchema = {
  type: 'object',
  properties: {
    candidates: { type: 'array', items: candidateSchema },
    unresolvedCandidates: { type: 'array', items: unresolvedCandidateSchema },
    conflictCandidates: { type: 'array', items: conflictCandidateSchema },
  },
  required: ['candidates', 'unresolvedCandidates', 'conflictCandidates'],
  additionalProperties: false,
};
