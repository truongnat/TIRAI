// ---------------------------------------------------------------------------
// Requirement consolidation response schema – sent to AIProvider
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

/** JSON Schema for the consolidation AI response. */
export const consolidationSchema: JSONSchema = {
  type: 'object',
  properties: {
    duplicateGroups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourceTemporaryIds: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['sourceTemporaryIds', 'reason', 'confidence'],
        additionalProperties: false,
      },
    },
    additionalConflicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requirementTemporaryIds: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
          type: { type: 'string' },
          provenance: { type: 'array', items: provenanceSchema },
          confidence: { type: 'number' },
        },
        required: ['requirementTemporaryIds', 'description', 'type', 'provenance', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['duplicateGroups', 'additionalConflicts'],
  additionalProperties: false,
};
