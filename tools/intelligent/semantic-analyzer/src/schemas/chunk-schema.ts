// ---------------------------------------------------------------------------
// Chunk analysis response schema – sent to AIProvider for structured output
// ---------------------------------------------------------------------------

import type { JSONSchema } from 'ai-provider';

const provenanceSchema = {
  type: 'object',
  properties: {
    contextId: { type: 'string' },
    sourceId: { type: 'string' },
    revisionId: { type: 'string' },
    artifactId: { type: 'string' },
    location: { type: 'object', properties: { segments: { type: 'array' } } },
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

const attributeSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    value: {},
    dataType: { type: 'string' },
    description: { type: 'string' },
    provenance: { type: 'array', items: provenanceSchema },
  },
  required: ['name'],
  additionalProperties: false,
} as const;

const conditionSchema = {
  type: 'object',
  properties: {
    expression: { type: 'string' },
    operands: { type: 'array', items: { type: 'string' } },
    provenance: { type: 'array', items: provenanceSchema },
  },
  required: ['expression'],
  additionalProperties: false,
} as const;

const effectSchema = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    target: { type: 'string' },
    value: {},
    provenance: { type: 'array', items: provenanceSchema },
  },
  required: ['description'],
  additionalProperties: false,
} as const;

const flowStepSchema = {
  type: 'object',
  properties: {
    order: { type: 'number' },
    action: { type: 'string' },
    actor: { type: 'string' },
    target: { type: 'string' },
    condition: { type: 'string' },
    outcome: { type: 'string' },
    provenance: { type: 'array', items: provenanceSchema },
  },
  required: ['order', 'action'],
  additionalProperties: false,
} as const;

/** JSON Schema for the per-chunk AI response. */
export const chunkAnalysisSchema: JSONSchema = {
  type: 'object',
  properties: {
    contextId: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          localId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          type: { type: 'string' },
          provenance: provenanceArray,
          confidence: { type: 'number' },
        },
        required: ['localId', 'title', 'provenance', 'confidence'],
        additionalProperties: false,
      },
    },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          localId: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string' },
          description: { type: 'string' },
          attributes: { type: 'array', items: attributeSchema },
          aliases: { type: 'array', items: { type: 'string' } },
          provenance: provenanceArray,
          confidence: { type: 'number' },
        },
        required: ['localId', 'name', 'type', 'provenance', 'confidence'],
        additionalProperties: false,
      },
    },
    flows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          localId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          actors: { type: 'array', items: { type: 'string' } },
          steps: { type: 'array', items: flowStepSchema },
          preconditions: { type: 'array', items: { type: 'string' } },
          postconditions: { type: 'array', items: { type: 'string' } },
          provenance: provenanceArray,
          confidence: { type: 'number' },
        },
        required: ['localId', 'name', 'steps', 'provenance', 'confidence'],
        additionalProperties: false,
      },
    },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          localId: { type: 'string' },
          type: { type: 'string' },
          statement: { type: 'string' },
          conditions: { type: 'array', items: conditionSchema },
          effects: { type: 'array', items: effectSchema },
          provenance: provenanceArray,
          confidence: { type: 'number' },
        },
        required: ['localId', 'type', 'statement', 'provenance', 'confidence'],
        additionalProperties: false,
      },
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          localId: { type: 'string' },
          type: { type: 'string' },
          sourceLocalId: { type: 'string' },
          targetLocalId: { type: 'string' },
          description: { type: 'string' },
          provenance: provenanceArray,
          confidence: { type: 'number' },
        },
        required: ['localId', 'type', 'sourceLocalId', 'targetLocalId', 'provenance', 'confidence'],
        additionalProperties: false,
      },
    },
    unresolved: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          localId: { type: 'string' },
          type: { type: 'string' },
          description: { type: 'string' },
          candidates: { type: 'array', items: { type: 'string' } },
          provenance: provenanceArray,
          reason: { type: 'string' },
        },
        required: ['localId', 'type', 'description', 'provenance', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['contextId', 'sections', 'entities', 'flows', 'rules', 'relationships', 'unresolved'],
  additionalProperties: false,
};
