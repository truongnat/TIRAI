// ---------------------------------------------------------------------------
// Test Data Planner – test fixtures, helpers, and factories
// ---------------------------------------------------------------------------

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import type {
  TestCaseIRInput,
  DataRequirementExtractionResult,
  DependencyAnalysisResult,
  DataRequirementCandidate,
  TestProvenance,
} from '../../src/models.js';
import { FakeAIProvider } from 'ai-provider';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const VALID_TEST_CASE_IR_DIR = path.join(__dirname, 'valid-test-case-ir');

// ---- Provenance factory ---------------------------------------------------

export function testProv(requirementId: string): TestProvenance {
  return { requirementId };
}

// ---- Test Case IR factory -------------------------------------------------

export function minimalTestCaseIR(overrides?: Partial<TestCaseIRInput>): TestCaseIRInput {
  return {
    schemaVersion: '1.0',
    testCases: [
      {
        id: 'TC-0001',
        scenarioId: 'SCN-0001',
        requirementIds: ['REQ-0001'],
        title: 'Successful login with valid credentials',
        objective: 'Verify login succeeds',
        type: 'api',
        priority: 'high',
        preconditions: [{ description: 'System is initialized', sourceRequirementIds: ['REQ-0001'] }],
        inputs: [{ name: 'requestBody', valueStrategy: '', description: 'Request payload' }],
        dataNeeds: [],
        steps: [{ order: 1, action: 'Send login request' }],
        expectedResults: [{ description: 'Login succeeds', verificationType: 'api' }],
        cleanup: [],
        automation: { status: 'ready', reasons: [] },
        provenance: [{ requirementId: 'REQ-0001' }],
        confidence: 0.9,
      },
    ],
    dataNeeds: [],
    ...overrides,
  };
}

// ---- Data requirement extraction result factory ---------------------------

export function dataReqResult(overrides?: Partial<DataRequirementExtractionResult>): DataRequirementExtractionResult {
  return {
    dataCandidates: [],
    unresolvedCandidates: [],
    ...overrides,
  };
}

export function dataCandidate(
  temporaryId: string,
  testCaseId: string,
  name: string,
  overrides?: Partial<DataRequirementCandidate>,
): DataRequirementCandidate {
  return {
    temporaryId,
    testCaseId,
    name,
    description: `Data need: ${name}`,
    type: 'input',
    lifecycle: 'unknown',
    strategy: 'unknown',
    constraints: [],
    relatedRequirementIds: ['REQ-0001'],
    relatedEntityIds: [],
    provenance: [testProv('REQ-0001')],
    confidence: 0.85,
    ...overrides,
  };
}

export function depResult(overrides?: Partial<DependencyAnalysisResult>): DependencyAnalysisResult {
  return {
    dependencyCandidates: [],
    reuseCandidates: [],
    ...overrides,
  };
}

// ---- FakeAIProvider builder -----------------------------------------------

export function buildDataPlannerFakeProvider(
  dataReqResponse?: DataRequirementExtractionResult,
  depResponse?: DependencyAnalysisResult,
): FakeAIProvider {
  const responses: unknown[] = [
    dataReqResponse ?? dataReqResult(),
    depResponse ?? depResult(),
  ];
  return new FakeAIProvider({
    name: 'fake',
    model: 'fake-model',
    responses,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  });
}

// ---- Temp directory helpers -----------------------------------------------

export function createTempTestCaseIR(ir: TestCaseIRInput): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdp-test-'));
  fs.writeFileSync(
    path.join(tmpDir, 'test-case-ir.json'),
    JSON.stringify(ir, null, 2),
    'utf-8',
  );
  return tmpDir;
}

export function createTempOutput(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tdp-out-'));
}
