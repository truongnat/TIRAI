// ---------------------------------------------------------------------------
// Test Planner – test fixtures, helpers, and factories
// ---------------------------------------------------------------------------

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import type {
  RequirementIRInput,
  CoverageAnalysisResult,
  ScenarioExtractionResult,
  TestCaseExtractionResult,
  CoverageCandidate,
  ScenarioCandidate,
  TestCaseCandidate,
  TestProvenance,
} from '../../src/models.js';
import { FakeAIProvider } from 'ai-provider';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to the on-disk valid Requirement IR fixture. */
export const VALID_REQUIREMENT_IR_DIR = path.join(__dirname, 'valid-requirement-ir');

// ---- Provenance factories -------------------------------------------------

export function testProv(requirementId: string, contextId?: string, sheet?: string): TestProvenance {
  return { requirementId, contextId, sheet };
}

// ---- Requirement IR fixture factory ---------------------------------------

export function minimalRequirementIR(overrides?: Partial<RequirementIRInput>): RequirementIRInput {
  return {
    schemaVersion: '1.0',
    document: {
      title: 'Test Spec',
      summary: 'A test specification',
      provenance: [{ contextId: 'ctx-001', sheet: 'Sheet1' }],
    },
    requirements: [
      {
        id: 'REQ-0001',
        title: 'Username required',
        type: 'validation',
        statement: 'The system shall require a non-empty username.',
        sourceNature: 'explicit',
        actor: 'User',
        preconditions: [],
        inputs: [{ name: 'username', required: true, constraints: ['non-empty'], provenance: [{ contextId: 'ctx-001' }] }],
        expectedBehaviors: [{ description: 'Validate username is not empty', provenance: [{ contextId: 'ctx-001' }] }],
        outcomes: [],
        constraints: [{ type: 'required', description: 'Username must not be empty', provenance: [{ contextId: 'ctx-001' }] }],
        relatedSemanticIds: [],
        provenance: [{ contextId: 'ctx-001', sheet: 'Sheet1' }],
        confidence: 0.9,
        testability: { status: 'testable', reasons: ['Has measurable expected behaviors'] },
      },
    ],
    unresolved: [],
    conflicts: [],
    quality: {
      total: 1, explicit: 1, derived: 0, testable: 1,
      partiallyTestable: 0, notTestable: 0, unknownTestability: 0,
      lowConfidence: 0, unresolved: 0, conflicts: 0, provenanceCoverage: 1.0,
    },
    ...overrides,
  };
}

// ---- Coverage analysis result factory -------------------------------------

export function coverageResult(overrides?: Partial<CoverageAnalysisResult>): CoverageAnalysisResult {
  return {
    coverageCandidates: [],
    unresolvedCandidates: [],
    ...overrides,
  };
}

export function coverageCandidate(reqId: string, strategies: string[], confidence = 0.9): CoverageCandidate {
  return {
    requirementId: reqId,
    strategies: strategies as CoverageCandidate['strategies'],
    reasons: [`Strategy justified for ${reqId}`],
    confidence,
  };
}

// ---- Scenario extraction result factory -----------------------------------

export function scenarioResult(overrides?: Partial<ScenarioExtractionResult>): ScenarioExtractionResult {
  return {
    scenarios: [],
    ...overrides,
  };
}

export function scenarioCandidate(
  temporaryId: string,
  title: string,
  requirementIds: string[],
  overrides?: Partial<ScenarioCandidate>,
): ScenarioCandidate {
  return {
    temporaryId,
    title,
    objective: `Test ${title}`,
    category: 'happy-path',
    requirementIds,
    preconditions: [],
    dataNeeds: [],
    expectedBehavior: ['Expected behavior from requirement'],
    priority: 'medium',
    provenance: requirementIds.map((id) => testProv(id)),
    confidence: 0.85,
    ...overrides,
  };
}

// ---- Test case extraction result factory ----------------------------------

export function testCaseResult(overrides?: Partial<TestCaseExtractionResult>): TestCaseExtractionResult {
  return {
    testCases: [],
    additionalDataNeeds: [],
    ...overrides,
  };
}

export function testCaseCandidate(
  temporaryId: string,
  scenarioTemporaryId: string,
  requirementIds: string[],
  overrides?: Partial<TestCaseCandidate>,
): TestCaseCandidate {
  return {
    temporaryId,
    scenarioTemporaryId,
    requirementIds,
    title: `Test case for ${scenarioTemporaryId}`,
    objective: 'Verify behavior',
    type: 'ui',
    priority: 'medium',
    preconditions: [],
    inputs: [{ name: 'username', valueStrategy: 'valid' }],
    dataNeeds: [],
    steps: [{ order: 1, action: 'Enter username' }],
    expectedResults: [{ description: 'Username accepted', verificationType: 'ui' }],
    cleanup: [],
    automation: { status: 'ready', suggestedExecutor: 'ui', reasons: ['Standard UI flow'] },
    provenance: requirementIds.map((id) => testProv(id)),
    confidence: 0.85,
    ...overrides,
  };
}

// ---- FakeAIProvider builder -----------------------------------------------

/**
 * Build a FakeAIProvider with queued responses for the test planner pipeline.
 *
 * Response order: coverage (per batch) → scenario → test case
 */
export function buildTestPlannerFakeProvider(
  coverageResponses: CoverageAnalysisResult[],
  scenarioResponse?: ScenarioExtractionResult,
  testCaseResponse?: TestCaseExtractionResult,
): FakeAIProvider {
  const responses: unknown[] = [
    ...coverageResponses,
    scenarioResponse ?? scenarioResult(),
    testCaseResponse ?? testCaseResult(),
  ];
  return new FakeAIProvider({
    name: 'fake',
    model: 'fake-model',
    responses,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  });
}

// ---- Temp directory helpers ------------------------------------------------

export function createTempRequirementIR(ir: RequirementIRInput): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-test-'));
  fs.writeFileSync(
    path.join(tmpDir, 'requirement-ir.json'),
    JSON.stringify(ir, null, 2),
    'utf-8',
  );
  return tmpDir;
}

export function createTempOutput(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tp-out-'));
}
