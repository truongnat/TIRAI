import {
  CanonicalOutputPayload,
  SourceRevision,
  ApplicationRevision,
  RequirementResult,
  TestCaseResult,
  VerificationSummary,
  EvidenceOriginSummary,
  SafeEvidenceReference,
  TraceSummary,
  OutputTimestamps,
} from './models.js';

export interface Scenario3Result {
  status: 'passed' | 'blocked' | 'failed' | 'error';
  requirements?: {
    sourceId?: string;
    revision?: string;
    contentHash?: string;
    revisionFingerprint?: string;
    [key: string]: unknown;
  };
  testPlan?: {
    scenarios?: Array<{
      id?: string;
      testCases?: Array<{
        id?: string;
        requirementIds?: string[];
        [key: string]: unknown;
      }>;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  execution?: {
    testResults?: Array<{
      testCaseId?: string;
      scenarioId?: string;
      requirementIds?: string[];
      status?: string;
      evidence?: Array<{
        id: string;
        type: string;
        sourceExecutor: string;
        artifactRef?: string;
        [key: string]: unknown;
      }>;
      [key: string]: unknown;
    }>;
    summary?: {
      testsTotal?: number;
      passed?: number;
      failed?: number;
      blocked?: number;
      skipped?: number;
      [key: string]: unknown;
    };
    evidence?: Array<{
      id: string;
      type: string;
      sourceExecutor: string;
      artifactRef?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  requirementResults?: Array<{
    requirementId: string;
    status: string;
    testCaseIds: string[];
    evidenceIds: string[];
    [key: string]: unknown;
  }>;
  trace?: {
    nodes?: Array<{
      id: string;
      kind: string;
      ref: string;
      [key: string]: unknown;
    }>;
    edges?: Array<{
      from: string;
      to: string;
      relation: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  warnings?: string[];
  metrics?: {
    runStartedAt?: string;
    runFinishedAt?: string;
    [key: string]: unknown;
  };
  revisionFingerprint?: string;
  runId?: string;
  [key: string]: unknown;
}

export function projectToCanonicalPayload(
  result: Scenario3Result,
  runId: string,
): CanonicalOutputPayload {
  const sourceRevision = extractSourceRevision(result);
  const applicationRevision = extractApplicationRevision(result);
  const requirements = extractRequirements(result);
  const testCases = extractTestCases(result);
  const verificationSummary = computeVerificationSummary(requirements, testCases);
  const evidenceOrigin = computeEvidenceOrigin(testCases);
  const safeEvidenceReferences = extractSafeEvidenceReferences(result);
  const traceSummary = extractTraceSummary(result);
  const timestamps = extractTimestamps(result);

  return {
    schemaVersion: '1.0',
    runId,
    sourceRevision,
    applicationRevision,
    requirements,
    testCases,
    verificationSummary,
    evidenceOrigin,
    safeEvidenceReferences,
    traceSummary,
    warnings: result.warnings ?? [],
    errors: [],
    timestamps,
  };
}

function extractSourceRevision(result: Scenario3Result): SourceRevision {
  const reqs = result.requirements;
  return {
    sourceId: reqs?.sourceId ?? 'unknown',
    revision: reqs?.revision ?? 'unknown',
    contentHash: reqs?.contentHash,
    revisionFingerprint: result.revisionFingerprint,
  };
}

function extractApplicationRevision(result: Scenario3Result): ApplicationRevision | undefined {
  const exec = result.execution;
  if (!exec) return undefined;

  return {
    name: 'unknown',
    tracked: false,
  };
}

function extractRequirements(result: Scenario3Result): RequirementResult[] {
  if (!result.requirementResults) return [];

  return result.requirementResults.map((rr) => ({
    requirementId: rr.requirementId,
    status: mapRequirementStatus(rr.status),
    testCaseIds: rr.testCaseIds ?? [],
    evidenceIds: rr.evidenceIds ?? [],
  }));
}

function mapRequirementStatus(
  status: string,
): 'PASS' | 'FAIL' | 'BLOCKED' | 'ERROR' | 'NOT_TESTED' {
  const normalized = status.toUpperCase();
  if (normalized === 'PASS' || normalized === 'PASSED') return 'PASS';
  if (normalized === 'FAIL' || normalized === 'FAILED') return 'FAIL';
  if (normalized === 'BLOCKED') return 'BLOCKED';
  if (normalized === 'ERROR') return 'ERROR';
  return 'NOT_TESTED';
}

function extractTestCases(result: Scenario3Result): TestCaseResult[] {
  const testCases: TestCaseResult[] = [];
  const execution = result.execution as Record<string, unknown> | undefined;

  if (!execution?.testResults) return testCases;

  const testResults = execution.testResults as Array<Record<string, unknown>>;

  for (const tr of testResults) {
    const evidenceIds = ((tr.evidence as Array<Record<string, unknown>>) ?? []).map((e) => e.id as string);
    const proofOrigin = determineProofOrigin(tr, evidenceIds);

    testCases.push({
      testCaseId: (tr.testCaseId as string) ?? (tr.scenarioId as string) ?? 'unknown',
      requirementIds: (tr.requirementIds as string[]) ?? [],
      status: mapTestCaseStatus(tr.status as string),
      proofOrigin,
      evidenceIds,
    });
  }

  return testCases;
}

function determineProofOrigin(
  tr: Record<string, unknown>,
  evidenceIds: string[],
): 'FRESH' | 'REUSED' | 'NOT_EXECUTED' {
  if (evidenceIds.length === 0) return 'NOT_EXECUTED';
  const status = (tr.status as string)?.toUpperCase();
  if (status === 'SKIPPED') return 'NOT_EXECUTED';
  return 'FRESH';
}

function mapTestCaseStatus(
  status: string | undefined,
): 'PASS' | 'FAIL' | 'BLOCKED' | 'ERROR' | 'SKIPPED' | 'MANUAL' {
  if (!status) return 'ERROR';
  const normalized = status.toUpperCase();
  if (normalized === 'PASS' || normalized === 'PASSED') return 'PASS';
  if (normalized === 'FAIL' || normalized === 'FAILED') return 'FAIL';
  if (normalized === 'BLOCKED') return 'BLOCKED';
  if (normalized === 'ERROR') return 'ERROR';
  if (normalized === 'SKIPPED') return 'SKIPPED';
  if (normalized === 'MANUAL') return 'MANUAL';
  return 'ERROR';
}

function computeVerificationSummary(
  requirements: RequirementResult[],
  testCases: TestCaseResult[],
): VerificationSummary {
  return {
    totalRequirements: requirements.length,
    passed: requirements.filter((r) => r.status === 'PASS').length,
    failed: requirements.filter((r) => r.status === 'FAIL').length,
    blocked: requirements.filter((r) => r.status === 'BLOCKED').length,
    error: requirements.filter((r) => r.status === 'ERROR').length,
    notTested: requirements.filter((r) => r.status === 'NOT_TESTED').length,
    totalTestCases: testCases.length,
    testCasesPassed: testCases.filter((tc) => tc.status === 'PASS').length,
    testCasesFailed: testCases.filter((tc) => tc.status === 'FAIL').length,
    testCasesBlocked: testCases.filter((tc) => tc.status === 'BLOCKED').length,
    testCasesSkipped: testCases.filter((tc) => tc.status === 'SKIPPED').length,
  };
}

function computeEvidenceOrigin(testCases: TestCaseResult[]): EvidenceOriginSummary {
  let fresh = 0;
  let reused = 0;
  let notTracked = 0;

  for (const tc of testCases) {
    if (tc.proofOrigin === 'FRESH') fresh++;
    else if (tc.proofOrigin === 'REUSED') reused++;
    else notTracked++;
  }

  return {
    freshEvidenceCount: fresh,
    reusedEvidenceCount: reused,
    notTrackedCount: notTracked,
  };
}

function extractSafeEvidenceReferences(result: Scenario3Result): SafeEvidenceReference[] {
  const refs: SafeEvidenceReference[] = [];
  const seen = new Set<string>();

  const execution = result.execution as Record<string, unknown> | undefined;
  const evidence = (execution?.evidence as Array<Record<string, unknown>>) ?? [];
  for (const e of evidence) {
    const id = e.id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    refs.push({
      evidenceId: id,
      type: e.type as string,
      sourceExecutor: e.sourceExecutor as string,
      safeArtifactRef: e.artifactRef as string | undefined,
    });
  }

  return refs;
}

function extractTraceSummary(result: Scenario3Result): TraceSummary {
  const trace = result.trace;
  return {
    nodes: (trace?.nodes ?? []).map((n) => ({
      id: n.id,
      kind: n.kind,
      ref: n.ref,
    })),
    edges: (trace?.edges ?? []).map((e) => ({
      from: e.from,
      to: e.to,
      relation: e.relation,
    })),
  };
}

function extractTimestamps(result: Scenario3Result): OutputTimestamps {
  return {
    runStartedAt: result.metrics?.runStartedAt,
    runFinishedAt: result.metrics?.runFinishedAt,
    projectedAt: new Date().toISOString(),
  };
}
