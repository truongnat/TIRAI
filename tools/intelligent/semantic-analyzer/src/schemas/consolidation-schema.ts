// ---------------------------------------------------------------------------
// Consolidation response schema – Pass 2 global AI consolidation
// ---------------------------------------------------------------------------

import type { JSONSchema } from 'ai-provider';

const provenanceRef = {
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

/** JSON Schema for the global consolidation AI response. */
export const consolidationSchema: JSONSchema = {
  type: 'object',
  properties: {
    mergeCandidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourceLocalIds: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['sourceLocalIds', 'reason', 'confidence'],
        additionalProperties: false,
      },
    },
    crossChunkRelationships: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          localId: { type: 'string' },
          type: { type: 'string' },
          sourceLocalId: { type: 'string' },
          targetLocalId: { type: 'string' },
          description: { type: 'string' },
          provenance: { type: 'array', items: provenanceRef },
          confidence: { type: 'number' },
        },
        required: ['localId', 'type', 'sourceLocalId', 'targetLocalId', 'provenance', 'confidence'],
        additionalProperties: false,
      },
    },
    documentSummary: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
        language: { type: 'array', items: { type: 'string' } },
        domainHints: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
  },
  required: ['mergeCandidates', 'crossChunkRelationships'],
  additionalProperties: false,
};
