// ---------------------------------------------------------------------------
// Test Planner – main orchestrator
// ---------------------------------------------------------------------------
// Pipeline:
//   1. Load Requirement IR
//   2. Build requirement batches
//   3. Coverage analysis (per-batch AI calls)
//   4. Scenario generation (AI call)
//   5. Test case generation (AI call)
//   6. Deterministic deduplication
//   7. Convert candidates → final artifacts with deterministic IDs
//   8. Build requirement coverage mapping
//   9. Final validation (traceability, provenance)
//  10. Compute quality metrics
//  11. Write output

import type { AIProvider } from 'ai-provider';
import type {
  TestPlanIR,
  TestScenario,
  TestCase,
  TestDataNeed,
  RequirementCoverage,
  CoverageStatus,
  TestPlanningUnresolved,
  TestPlannerWarning,
  TestPlannerManifest,
  TestPlannerOptions,
  RequirementIRInput,
  CoverageAnalysisResult,
  CoverageCandidate,
  ScenarioCandidate,
  TestCaseExtractionResult,
  TestProvenance,
  UnresolvedReason,
} from './models.js';
import { TestPlannerWarningCode, TEST_CONFIDENCE_THRESHOLD } from './warnings.js';
import { loadRequirementIR } from './persistence/loader.js';
import { analyzeCoverage } from './analysis/coverage-analyzer.js';
import { generateScenarios } from './analysis/scenario-generator.js';
import { generateTestCases } from './analysis/test-case-generator.js';
import { deduplicateScenarios, deduplicateTestCases } from './merge/deduplicator.js';
import {
  buildValidRequirementIds,
  validateRequirementReferences,
} from './validation/requirement-ir-validator.js';
import {
  validateScenarioReferences,
  validateScenarioCoverage,
  validateRequirementCoverageChain,
  validateExpectedResults,
  validateExecutableTestCases,
} from './validation/traceability-validator.js';
import { validateTestProvenance } from './validation/provenance-validator.js';
import { computeQualityMetrics } from './quality/metrics.js';
import { writeOutput, writeIntermediate } from './persistence/writer.js';
import {
  loadCheckpoint,
  writeStageCheckpoint,
  writeCheckpointMeta,
} from './persistence/checkpoint.js';
import { computeFingerprint } from './fingerprint.js';
import { TEST_PLANNER_PROMPT_VERSION } from './prompts/system.js';

/** Default batch size for coverage analysis. */
const DEFAULT_BATCH_SIZE = 10;

/**
 * Build a test plan from a Requirement IR.
 */
export async function buildTestPlan(
  inputDir: string,
  provider: AIProvider,
  options?: TestPlannerOptions,
): Promise<TestPlanIR> {
  return buildTestPlanFromRequirementIR(
    loadRequirementIR(inputDir),
    provider,
    options,
    inputDir,
  );
}

/** Build a test plan directly from an in-memory Requirement IR. */
export async function buildTestPlanFromRequirementIR(
  requirementIR: RequirementIRInput,
  provider: AIProvider,
  options?: TestPlannerOptions,
  sourceRef = 'in-memory://requirement-ir',
): Promise<TestPlanIR> {
  const promptVersion = options?.promptVersion ?? TEST_PLANNER_PROMPT_VERSION;
  const maxRepairAttempts = options?.maxRepairAttempts ?? 1;
  const outputDir = options?.outputDir;

  // ---- Load Requirement IR ------------------------------------------------
  const requirementContent = JSON.stringify(requirementIR);

  const allWarnings: TestPlannerWarning[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let aiRequests = 0;

  const validReqIds = buildValidRequirementIds(requirementIR);
  const requirements = requirementIR.requirements;

  // ---- Compute fingerprint for checkpoint validation ----------------------
  const fingerprint = computeFingerprint(requirementContent, promptVersion, provider.name);

  // ---- Load checkpoint if resuming ----------------------------------------
  const resume = options?.resume ?? false;
  const checkpoint = resume && outputDir ? loadCheckpoint(outputDir, fingerprint) : {};

  // Write checkpoint metadata on fresh run (not resuming) so future resume
  // can validate against this fingerprint.
  if (!resume && outputDir) {
    writeCheckpointMeta(outputDir, fingerprint);
  }

  // ---- Pass 1: Coverage analysis (per-batch) ------------------------------
  const batches = buildBatches(requirements, DEFAULT_BATCH_SIZE);
  let allCoverage: CoverageCandidate[] = [];
  let allUnresolvedRaw: Array<{
    requirementId: string;
    description: string;
    reason: UnresolvedReason;
    provenance: TestProvenance[];
  }> = [];

  if (checkpoint.coverage) {
    // Resume from checkpoint
    allCoverage = checkpoint.coverage.coverageCandidates;
    allUnresolvedRaw = checkpoint.coverage.unresolvedCandidates.map((u) => ({
      requirementId: u.requirementId,
      description: u.description,
      reason: u.reason as UnresolvedReason,
      provenance: u.provenance,
    }));
  } else {
    // Run coverage analysis
    for (const batch of batches) {
      const {
        result,
        usage,
        warnings: coverageWarnings,
      } = await analyzeCoverage(batch, provider, maxRepairAttempts);

      aiRequests++;
      totalInputTokens += usage.inputTokens ?? 0;
      totalOutputTokens += usage.outputTokens ?? 0;

      if (coverageWarnings) allWarnings.push(...coverageWarnings);

      allCoverage.push(...result.coverageCandidates);
      for (const u of result.unresolvedCandidates) {
        allUnresolvedRaw.push(u);
      }
    }

    // Write checkpoint after coverage completes
    if (outputDir) {
      writeStageCheckpoint(outputDir, 'coverage', {
        coverageCandidates: allCoverage,
        unresolvedCandidates: allUnresolvedRaw.map((u) => ({
          requirementId: u.requirementId,
          description: u.description,
          reason: u.reason,
          provenance: u.provenance,
        })),
      });
    }
  }

  // ---- Pass 2: Scenario generation ----------------------------------------
  let scenarioResult: { scenarios: ScenarioCandidate[] };
  if (checkpoint.scenarios) {
    // Resume from checkpoint
    scenarioResult = { scenarios: checkpoint.scenarios };
  } else {
    // Run scenario generation
    const {
      result,
      usage,
      warnings: scenarioWarnings,
    } = await generateScenarios(requirements, allCoverage, provider, maxRepairAttempts);

    aiRequests++;
    totalInputTokens += usage.inputTokens ?? 0;
    totalOutputTokens += usage.outputTokens ?? 0;
    if (scenarioWarnings) allWarnings.push(...scenarioWarnings);

    scenarioResult = result;

    // Write checkpoint after scenarios complete
    if (outputDir) {
      writeStageCheckpoint(outputDir, 'scenarios', result.scenarios);
    }
  }

  // ---- Pass 3: Test case generation ---------------------------------------
  let testCaseResult: TestCaseExtractionResult;
  if (checkpoint.testCases) {
    // Resume from checkpoint
    testCaseResult = { testCases: checkpoint.testCases, additionalDataNeeds: [] };
  } else {
    // Run test case generation
    const {
      result,
      usage,
      warnings: testCaseWarnings,
    } = await generateTestCases(
      requirements,
      scenarioResult.scenarios,
      provider,
      maxRepairAttempts,
    );

    aiRequests++;
    totalInputTokens += usage.inputTokens ?? 0;
    totalOutputTokens += usage.outputTokens ?? 0;
    if (testCaseWarnings) allWarnings.push(...testCaseWarnings);

    testCaseResult = result;

    // Write checkpoint after test cases complete
    if (outputDir) {
      writeStageCheckpoint(outputDir, 'testCases', result.testCases);
    }
  }

  // ---- Deduplication ------------------------------------------------------
  const { deduped: dedupedScenarios, warnings: dedupScenarioWarnings } = deduplicateScenarios(
    scenarioResult.scenarios,
  );
  allWarnings.push(...dedupScenarioWarnings);

  const { deduped: dedupedTestCases, warnings: dedupTCWarnings } = deduplicateTestCases(
    testCaseResult.testCases,
  );
  allWarnings.push(...dedupTCWarnings);

  // ---- Assign deterministic IDs -------------------------------------------
  // Build temporary ID → final ID mapping for scenarios
  const scenarioIdMap = new Map<string, string>();
  const finalScenarios: TestScenario[] = dedupedScenarios.map((s, i) => {
    const id = `SCN-${String(i + 1).padStart(4, '0')}`;
    scenarioIdMap.set(s.temporaryId, id);

    return {
      id,
      title: s.title,
      objective: s.objective,
      category: s.category,
      requirementIds: s.requirementIds.filter((id) => validReqIds.has(id)),
      preconditions: s.preconditions.map((p) => ({
        description: p.description,
        sourceRequirementIds: p.sourceRequirementIds.filter((id) => validReqIds.has(id)),
      })),
      dataNeeds: [], // Populated later from data needs
      expectedBehavior: s.expectedBehavior,
      priority: s.priority,
      provenance: mergeRequirementProvenance(s.provenance, s.requirementIds, requirements),
      confidence: s.confidence,
    };
  });

  // Build reverse lookup: scenario temporary ID → final scenario ID
  const finalTestCases: TestCase[] = [];
  for (const tc of dedupedTestCases) {
    const scenarioId = scenarioIdMap.get(tc.scenarioTemporaryId);
    if (!scenarioId) continue; // Skip test cases for removed scenarios

    const id = `TC-${String(finalTestCases.length + 1).padStart(4, '0')}`;

    finalTestCases.push({
      id,
      scenarioId,
      requirementIds: tc.requirementIds.filter((id) => validReqIds.has(id)),
      title: tc.title,
      objective: tc.objective,
      type: tc.type,
      priority: tc.priority,
      preconditions: tc.preconditions.map((p) => ({
        description: p.description,
        sourceRequirementIds: p.sourceRequirementIds.filter((id) => validReqIds.has(id)),
      })),
      inputs: tc.inputs.map((i) => ({
        name: i.name,
        valueStrategy: i.valueStrategy,
        value: i.value,
        description: i.description,
      })),
      dataNeeds: [], // Populated later
      steps: tc.steps.map((s) => ({
        order: s.order,
        action: s.action,
        target: s.target,
        input: s.input,
        expectedIntermediateResult: s.expectedIntermediateResult,
      })),
      expectedResults: tc.expectedResults.map((e) => ({
        description: e.description,
        verificationType: e.verificationType,
        target: e.target,
        verificationIntent: e.verificationIntent,
      })),
      cleanup: tc.cleanup.map((c) => ({
        description: c.description,
        target: c.target,
      })),
      automation: {
        status: tc.automation.status,
        suggestedExecutor: tc.automation.suggestedExecutor,
        reasons: tc.automation.reasons,
      },
      provenance: mergeRequirementProvenance(tc.provenance, tc.requirementIds, requirements),
      confidence: tc.confidence,
    });
  }

  // ---- Build data needs ---------------------------------------------------
  const allDataNeeds: TestDataNeed[] = [];
  const dataNeedMap = new Map<string, number>(); // description → index

  const collectDataNeeds = (
    rawNeeds: Array<{
      description: string;
      type: string;
      constraints: string[];
      relatedRequirementIds: string[];
      sourceScenarioId?: string;
      provenance?: TestProvenance[];
    }>,
  ): void => {
    for (const dn of rawNeeds) {
      const key = [
        dn.description.toLowerCase().trim(),
        dn.type,
        ...[...dn.constraints].sort(),
        ...[...dn.relatedRequirementIds].sort(),
      ].join('|');
      if (dataNeedMap.has(key)) continue;

      const id = `DATA-${String(allDataNeeds.length + 1).padStart(4, '0')}`;
      dataNeedMap.set(key, allDataNeeds.length);

      allDataNeeds.push({
        id,
        description: dn.description,
        type: dn.type as TestDataNeed['type'],
        constraints: dn.constraints,
        relatedRequirementIds: dn.relatedRequirementIds.filter((id) => validReqIds.has(id)),
        sourceScenarioId: dn.sourceScenarioId,
        provenance: dn.provenance,
      });
    }
  };

  // Collect from scenarios
  for (const s of dedupedScenarios) {
    collectDataNeeds(
      s.dataNeeds.map((need) => ({
        ...need,
        sourceScenarioId: need.sourceScenarioId ?? s.temporaryId,
      })),
    );
  }
  // Collect from test cases
  for (const tc of dedupedTestCases) {
    collectDataNeeds(tc.dataNeeds);
  }
  // Collect additional data needs from test case extraction
  collectDataNeeds(testCaseResult.additionalDataNeeds);
  // Collect requirement-owned needs before linking scenario/test-case views.
  for (const requirement of requirements) {
    collectDataNeeds(
      (requirement.dataNeeds ?? []).map((need) => ({
        description: need.description,
        type: need.type ?? 'other',
        constraints: need.constraints ?? [],
        relatedRequirementIds: [requirement.id],
        provenance: need.provenance.map((provenance) => ({
          ...provenance,
          requirementId: requirement.id,
        })),
      })),
    );
  }

  // Link data needs to scenarios and test cases
  for (const s of finalScenarios) {
    const candidate = dedupedScenarios.find((c) => scenarioIdMap.get(c.temporaryId) === s.id);
    if (candidate) {
      const requirementNeeds = s.requirementIds.flatMap((requirementId) => {
        const requirement = requirements.find(
          (candidateRequirement) => candidateRequirement.id === requirementId,
        );
        return (
          requirement?.dataNeeds?.map((need) => ({
            description: need.description,
            type: need.type ?? 'other',
            constraints: need.constraints ?? [],
            relatedRequirementIds: [requirementId],
          })) ?? []
        );
      });
      s.dataNeeds = resolveDataNeeds(
        [...candidate.dataNeeds, ...requirementNeeds],
        allDataNeeds,
        dataNeedMap,
      );
    }
  }
  for (const tc of finalTestCases) {
    const candidate = dedupedTestCases.find(
      (c) => scenarioIdMap.get(c.scenarioTemporaryId) === tc.scenarioId && c.title === tc.title,
    );
    if (candidate) {
      const scenario = finalScenarios.find((s) => s.id === tc.scenarioId);
      const scenarioCandidate = scenario
        ? dedupedScenarios.find((s) => scenarioIdMap.get(s.temporaryId) === scenario.id)
        : undefined;
      const inherited =
        scenarioCandidate?.dataNeeds.map((need) => ({
          ...need,
          sourceScenarioId: tc.scenarioId,
        })) ?? [];
      const requirementNeeds = tc.requirementIds.flatMap((requirementId) => {
        const requirement = requirements.find(
          (candidateRequirement) => candidateRequirement.id === requirementId,
        );
        return (requirement?.dataNeeds ?? []).map((need) => ({
          description: need.description,
          type: need.type ?? 'other',
          constraints: need.constraints ?? [],
          relatedRequirementIds: [requirementId],
          provenance: need.provenance.map((provenance) => ({ ...provenance, requirementId })),
        }));
      });
      tc.dataNeeds = resolveDataNeeds(
        [...candidate.dataNeeds, ...inherited, ...requirementNeeds],
        allDataNeeds,
        dataNeedMap,
      );
    }
  }

  // ---- Build requirement coverage -----------------------------------------
  const requirementCoverage = buildRequirementCoverage(
    requirements,
    allCoverage,
    finalScenarios,
    finalTestCases,
  );

  // ---- Build unresolved ---------------------------------------------------
  const finalUnresolved: TestPlanningUnresolved[] = allUnresolvedRaw.map((u, i) => ({
    id: `TEST-UNRESOLVED-${String(i + 1).padStart(4, '0')}`,
    requirementIds: validReqIds.has(u.requirementId) ? [u.requirementId] : [],
    description: u.description,
    reason: u.reason as TestPlanningUnresolved['reason'],
    provenance: u.provenance.filter((p) => validReqIds.has(p.requirementId)),
  }));

  // Warn for requirements not covered by coverage analysis
  const coveredReqIds = new Set(allCoverage.map((c) => c.requirementId));
  for (const req of requirements) {
    if (!coveredReqIds.has(req.id)) {
      allWarnings.push({
        code: TestPlannerWarningCode.REQUIREMENT_NOT_COVERED,
        message: `Requirement ${req.id} has no coverage analysis`,
        requirementId: req.id,
      });
    }
  }

  // ---- Final validation ---------------------------------------------------
  for (const tc of finalTestCases) {
    allWarnings.push(...validateExpectedResults([tc]));
    allWarnings.push(...validateTestProvenance(tc.provenance, validReqIds, tc.id));
    allWarnings.push(
      ...validateRequirementReferences(tc.requirementIds, validReqIds, tc.id, 'test-case'),
    );
  }

  allWarnings.push(...validateScenarioCoverage(finalScenarios, finalTestCases));
  allWarnings.push(...validateRequirementCoverageChain(requirementCoverage, finalScenarios));
  allWarnings.push(...validateScenarioReferences(finalTestCases, finalScenarios));
  allWarnings.push(...validateExecutableTestCases(finalTestCases));

  for (const s of finalScenarios) {
    allWarnings.push(
      ...validateRequirementReferences(s.requirementIds, validReqIds, s.id, 'scenario'),
    );
    allWarnings.push(...validateTestProvenance(s.provenance, validReqIds, s.id));
  }

  // Low confidence warnings
  for (const tc of finalTestCases) {
    if (tc.confidence < TEST_CONFIDENCE_THRESHOLD.MEDIUM) {
      allWarnings.push({
        code: TestPlannerWarningCode.CASE_LOW_CONFIDENCE,
        message: `Test case ${tc.id} has low confidence (${tc.confidence})`,
        testCaseId: tc.id,
      });
    }
  }

  // ---- Quality metrics ----------------------------------------------------
  const quality = computeQualityMetrics(
    requirementCoverage,
    finalScenarios,
    finalTestCases,
    finalUnresolved,
  );

  // ---- Assemble final IR --------------------------------------------------
  const scope = {
    requirementIds: requirements.map((r) => r.id),
    objective:
      requirementIR.document.summary ??
      `Test plan for ${requirementIR.requirements.length} requirements`,
    assumptions: ['All requirements in the Requirement IR are in scope'],
    exclusions: [
      'Test data generation (belongs to Test Data Planner)',
      'Test execution (belongs to executor)',
    ],
  };

  const testPlanIR: TestPlanIR = {
    schemaVersion: '1.0',
    scope,
    requirementCoverage,
    scenarios: finalScenarios,
    testCases: finalTestCases,
    dataNeeds: allDataNeeds,
    unresolved: finalUnresolved,
    quality,
    warnings: allWarnings,
  };

  // ---- Write output -------------------------------------------------------
  if (outputDir) {
    const coverageResult: CoverageAnalysisResult = {
      coverageCandidates: allCoverage,
      unresolvedCandidates: allUnresolvedRaw,
    };

    const manifest: TestPlannerManifest = {
      schemaVersion: '1.0',
      source: { requirementIR: sourceRef },
      provider: { name: provider.name, model: '' },
      promptVersion,
      stats: {
        requirements: requirements.length,
        scenarios: finalScenarios.length,
        testCases: finalTestCases.length,
        dataNeeds: allDataNeeds.length,
        unresolved: finalUnresolved.length,
        coverageRate: quality.coverageRate,
      },
      usage: {
        requests: aiRequests,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
      },
      fingerprint,
      warnings: allWarnings,
    };

    writeOutput(outputDir, testPlanIR, manifest);
    writeIntermediate(outputDir, coverageResult, dedupedScenarios, dedupedTestCases);
  }

  return testPlanIR;
}

// ---- Helpers --------------------------------------------------------------

/**
 * Split requirements into batches for AI processing.
 */
function buildBatches(
  requirements: RequirementIRInput['requirements'],
  batchSize: number,
): Array<RequirementIRInput['requirements']> {
  const batches: Array<RequirementIRInput['requirements']> = [];
  for (let i = 0; i < requirements.length; i += batchSize) {
    batches.push(requirements.slice(i, i + batchSize));
  }
  return batches.length > 0 ? batches : [requirements];
}

/**
 * Build requirement coverage mapping from coverage analysis + scenarios.
 */
function buildRequirementCoverage(
  requirements: RequirementIRInput['requirements'],
  coverage: CoverageCandidate[],
  scenarios: TestScenario[],
  testCases: TestCase[],
): RequirementCoverage[] {
  const coverageMap = new Map(coverage.map((c) => [c.requirementId, c]));

  // Build scenario lookup per requirement
  const reqToScenarios = new Map<string, string[]>();
  const executableScenarioIds = new Set(
    testCases.filter((tc) => isExecutableTestCase(tc)).map((tc) => tc.scenarioId),
  );
  for (const s of scenarios) {
    for (const reqId of s.requirementIds) {
      const ids = reqToScenarios.get(reqId) ?? [];
      ids.push(s.id);
      reqToScenarios.set(reqId, ids);
    }
  }

  return requirements.map((req) => {
    const cov = coverageMap.get(req.id);
    const scenarioIds = reqToScenarios.get(req.id) ?? [];

    let status: CoverageStatus;
    if (scenarioIds.some((scenarioId) => executableScenarioIds.has(scenarioId))) {
      status = 'covered';
    } else if (scenarioIds.length > 0 || (cov && cov.strategies.length > 0)) {
      status = 'partially-covered';
    } else {
      status = 'not-covered';
    }

    return {
      requirementId: req.id,
      strategies: cov?.strategies ?? [],
      scenarioIds,
      status,
      reasons: cov?.reasons ?? [],
    };
  });
}

function isExecutableTestCase(testCase: TestCase): boolean {
  if (testCase.steps.length === 0 || testCase.expectedResults.length === 0) return false;
  if (testCase.automation.status === 'manual-only' || testCase.automation.status === 'unknown')
    return false;
  return testCase.steps.every(
    (step, index) =>
      step.action.trim().length > 0 &&
      Number.isFinite(step.order) &&
      (index === 0 || step.order > testCase.steps[index - 1]!.order),
  );
}

/**
 * Resolve data need references to actual data need objects with IDs.
 */
function resolveDataNeeds(
  rawNeeds: Array<{
    description: string;
    type: string;
    constraints: string[];
    relatedRequirementIds: string[];
  }>,
  allDataNeeds: TestDataNeed[],
  dataNeedMap: Map<string, number>,
): TestDataNeed[] {
  const result: TestDataNeed[] = [];
  const seen = new Set<string>();

  for (const dn of rawNeeds) {
    const key = [
      dn.description.toLowerCase().trim(),
      dn.type,
      ...[...dn.constraints].sort(),
      ...[...dn.relatedRequirementIds].sort(),
    ].join('|');
    const idx = dataNeedMap.get(key);
    if (idx !== undefined && !seen.has(allDataNeeds[idx]!.id)) {
      seen.add(allDataNeeds[idx]!.id);
      result.push(allDataNeeds[idx]!);
    }
  }

  return result;
}

function mergeRequirementProvenance(
  own: TestProvenance[],
  requirementIds: string[],
  requirements: RequirementIRInput['requirements'],
): TestProvenance[] {
  const merged = [...own];
  for (const requirementId of requirementIds) {
    const requirement = requirements.find((candidate) => candidate.id === requirementId);
    for (const provenance of requirement?.provenance ?? []) {
      const inherited: TestProvenance = { ...provenance, requirementId };
      if (!merged.some((existing) => provenanceKey(existing) === provenanceKey(inherited))) {
        merged.push(inherited);
      }
    }
  }
  return merged.filter((provenance) => validRequirementId(requirements, provenance.requirementId));
}

function validRequirementId(
  requirements: RequirementIRInput['requirements'],
  requirementId: string,
): boolean {
  return requirements.some((requirement) => requirement.id === requirementId);
}

function provenanceKey(provenance: TestProvenance): string {
  return [
    provenance.requirementId,
    provenance.contextId ?? '',
    provenance.sheet ?? '',
    ...(provenance.ranges ?? []),
    ...(provenance.cells ?? []),
  ].join('|');
}
