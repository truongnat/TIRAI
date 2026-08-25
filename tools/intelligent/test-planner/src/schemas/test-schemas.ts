// ---------------------------------------------------------------------------
// Test Planner – JSON schemas for AI responses
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

// ---- Coverage schema ------------------------------------------------------

const coverageCandidateSchema = {
  type: 'object',
  properties: {
    requirementId: { type: 'string' },
    strategies: { type: 'array', items: { type: 'string' } },
    reasons: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
  },
  required: ['requirementId', 'strategies', 'reasons', 'confidence'],
  additionalProperties: false,
} as const;

const coverageUnresolvedSchema = {
  type: 'object',
  properties: {
    requirementId: { type: 'string' },
    description: { type: 'string' },
    reason: { type: 'string' },
    provenance: provenanceArray,
  },
  required: ['requirementId', 'description', 'reason', 'provenance'],
  additionalProperties: false,
} as const;

/** JSON Schema for coverage analysis AI response. */
export const coverageAnalysisSchema: JSONSchema = {
  type: 'object',
  properties: {
    coverageCandidates: { type: 'array', items: coverageCandidateSchema },
    unresolvedCandidates: { type: 'array', items: coverageUnresolvedSchema },
  },
  required: ['coverageCandidates', 'unresolvedCandidates'],
  additionalProperties: false,
};

// ---- Scenario schema ------------------------------------------------------

const preconditionSchema = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    sourceRequirementIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['description', 'sourceRequirementIds'],
  additionalProperties: false,
} as const;

const dataNeedSchema = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    type: { type: 'string' },
    constraints: { type: 'array', items: { type: 'string' } },
    relatedRequirementIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['description', 'type', 'constraints', 'relatedRequirementIds'],
  additionalProperties: false,
} as const;

const scenarioCandidateSchema = {
  type: 'object',
  properties: {
    temporaryId: { type: 'string' },
    title: { type: 'string' },
    objective: { type: 'string' },
    category: { type: 'string' },
    requirementIds: { type: 'array', items: { type: 'string' } },
    preconditions: { type: 'array', items: preconditionSchema },
    dataNeeds: { type: 'array', items: dataNeedSchema },
    expectedBehavior: { type: 'array', items: { type: 'string' } },
    priority: { type: 'string' },
    provenance: provenanceArray,
    confidence: { type: 'number' },
  },
  required: [
    'temporaryId',
    'title',
    'objective',
    'category',
    'requirementIds',
    'preconditions',
    'dataNeeds',
    'expectedBehavior',
    'priority',
    'provenance',
    'confidence',
  ],
  additionalProperties: false,
} as const;

/** JSON Schema for scenario extraction AI response. */
export const scenarioExtractionSchema: JSONSchema = {
  type: 'object',
  properties: {
    scenarios: { type: 'array', items: scenarioCandidateSchema },
  },
  required: ['scenarios'],
  additionalProperties: false,
};

// ---- Test case schema -----------------------------------------------------

const stepSchema = {
  type: 'object',
  properties: {
    order: { type: 'number' },
    action: { type: 'string' },
    target: { type: 'string' },
    input: { type: 'string' },
    expectedIntermediateResult: { type: 'string' },
  },
  required: ['order', 'action'],
  additionalProperties: false,
} as const;

const expectedResultSchema = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    verificationType: { type: 'string' },
    target: { type: 'string' },
    verificationIntent: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        subject: { type: 'string' },
        property: { type: 'string' },
        expectedValue: {},
        authority: { type: 'string' },
        requiredSources: { type: 'array', items: { type: 'string' } },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  required: ['description', 'verificationType'],
  additionalProperties: false,
} as const;

const inputSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    valueStrategy: { type: 'string' },
    value: {},
    description: { type: 'string' },
  },
  required: ['name', 'valueStrategy'],
  additionalProperties: false,
} as const;

const cleanupSchema = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    target: { type: 'string' },
  },
  required: ['description'],
  additionalProperties: false,
} as const;

const automationSchema = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    suggestedExecutor: { type: 'string' },
    reasons: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'reasons'],
  additionalProperties: false,
} as const;

const testCaseCandidateSchema = {
  type: 'object',
  properties: {
    temporaryId: { type: 'string' },
    scenarioTemporaryId: { type: 'string' },
    requirementIds: { type: 'array', items: { type: 'string' } },
    title: { type: 'string' },
    objective: { type: 'string' },
    type: { type: 'string' },
    priority: { type: 'string' },
    preconditions: { type: 'array', items: preconditionSchema },
    inputs: { type: 'array', items: inputSchema },
    dataNeeds: { type: 'array', items: dataNeedSchema },
    steps: { type: 'array', items: stepSchema },
    expectedResults: { type: 'array', items: expectedResultSchema },
    cleanup: { type: 'array', items: cleanupSchema },
    automation: automationSchema,
    provenance: provenanceArray,
    confidence: { type: 'number' },
  },
  required: [
    'temporaryId',
    'scenarioTemporaryId',
    'requirementIds',
    'title',
    'objective',
    'type',
    'priority',
    'preconditions',
    'inputs',
    'steps',
    'expectedResults',
    'cleanup',
    'automation',
    'provenance',
    'confidence',
  ],
  additionalProperties: false,
} as const;

/** JSON Schema for test case extraction AI response. */
export const testCaseExtractionSchema: JSONSchema = {
  type: 'object',
  properties: {
    testCases: { type: 'array', items: testCaseCandidateSchema },
    additionalDataNeeds: { type: 'array', items: dataNeedSchema },
  },
  required: ['testCases', 'additionalDataNeeds'],
  additionalProperties: false,
};
