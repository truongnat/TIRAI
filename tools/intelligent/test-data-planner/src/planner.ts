// ---------------------------------------------------------------------------
// Test Data Planner – main orchestrator
// ---------------------------------------------------------------------------
// Pipeline:
//   1. Load Test Case IR (and optionally Test Plan IR)
//   2. Compute fingerprint for checkpoint validation
//   3. Data requirement extraction (AI call)
//   4. Dependency/reuse analysis (AI call)
//   5. Deterministic deduplication
//   6. Convert candidates → final data items with deterministic IDs
//   7. Build dependency graph with cycle detection
//   8. Build reusable data sets
//   9. Build per-test-case data plans
//  10. Final validation (references, provenance)
//  11. Compute quality metrics
//  12. Write output

import type { AIProvider } from 'ai-provider';
import type {
  TestDataPlanIR,
  TestDataItem,
  TestCaseDataPlan,
  ReusableDataSet,
  TestDataUnresolved,
  TestDataPlannerWarning,
  TestDataPlannerManifest,
  TestDataPlannerOptions,
  DataRequirementCandidate,
  DataRequirementExtractionResult,
  DependencyAnalysisResult,
  DataConstraintType,
} from './models.js';
import { TestDataPlannerWarningCode } from './warnings.js';
import { loadTestCaseIR, loadTestCaseIRContent, loadTestPlanIRContent } from './persistence/loader.js';
import { extractDataRequirements } from './analysis/data-requirement-extractor.js';
import { analyzeDependencies } from './analysis/dependency-analyzer.js';
import { deduplicateDataCandidates } from './merge/deduplicator.js';
import { buildDependencyGraph } from './graph/dependency-graph.js';
import { validateTestCaseReferences, validateRequirementReferences, validateProvenance } from './validation/reference-validator.js';
import { computeDataQualityMetrics } from './quality/metrics.js';
import { writeDataOutput, writeDataIntermediate } from './persistence/writer.js';
import { loadDataCheckpoint, writeDataStageCheckpoint, writeDataCheckpointMeta } from './persistence/checkpoint.js';
import { computeFingerprint } from './fingerprint.js';
import { TEST_DATA_PLANNER_PROMPT_VERSION } from './prompts/system.js';

/**
 * Build a test data plan from a Test Case IR.
 */
export async function buildTestDataPlan(
  inputDir: string,
  provider: AIProvider,
  options?: TestDataPlannerOptions,
): Promise<TestDataPlanIR> {
  const promptVersion = options?.promptVersion ?? TEST_DATA_PLANNER_PROMPT_VERSION;
  const maxRepairAttempts = options?.maxRepairAttempts ?? 1;
  const outputDir = options?.outputDir;

  // ---- Load Test Case IR --------------------------------------------------
  const testCaseIR = loadTestCaseIR(inputDir);
  const testCaseContent = loadTestCaseIRContent(inputDir);
  const testPlanContent = loadTestPlanIRContent(inputDir);

  const allWarnings: TestDataPlannerWarning[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let aiRequests = 0;

  const testCases = testCaseIR.testCases;
  const validTCIds = new Set(testCases.map((tc) => tc.id));

  // ---- Compute fingerprint ------------------------------------------------
  const fingerprint = computeFingerprint(testCaseContent, promptVersion, provider.name, testPlanContent ?? undefined);

  // ---- Load checkpoint if resuming ----------------------------------------
  const resume = options?.resume ?? false;
  const checkpoint = resume && outputDir ? loadDataCheckpoint(outputDir, fingerprint) : {};

  if (!resume && outputDir) {
    writeDataCheckpointMeta(outputDir, fingerprint);
  }

  // ---- Pass 1: Data requirement extraction --------------------------------
  let dataReqResult: DataRequirementExtractionResult;
  if (checkpoint.dataRequirements) {
    dataReqResult = checkpoint.dataRequirements;
  } else {
    const { result, usage, warnings } = await extractDataRequirements(
      testCases, provider, maxRepairAttempts, testCaseIR.dataNeeds,
    );
    aiRequests++;
    totalInputTokens += usage.inputTokens ?? 0;
    totalOutputTokens += usage.outputTokens ?? 0;
    if (warnings) allWarnings.push(...warnings);
    dataReqResult = result;

    if (outputDir) {
      writeDataStageCheckpoint(outputDir, 'dataRequirements', result);
    }
  }

  // ---- Pass 2: Dependency/reuse analysis ----------------------------------
  let depResult: DependencyAnalysisResult;
  if (checkpoint.dependencyAnalysis) {
    depResult = checkpoint.dependencyAnalysis;
  } else {
    const { result, usage, warnings } = await analyzeDependencies(
      dataReqResult.dataCandidates, provider, maxRepairAttempts,
    );
    aiRequests++;
    totalInputTokens += usage.inputTokens ?? 0;
    totalOutputTokens += usage.outputTokens ?? 0;
    if (warnings) allWarnings.push(...warnings);
    depResult = result;

    if (outputDir) {
      writeDataStageCheckpoint(outputDir, 'dependencyAnalysis', result);
    }
  }

  // ---- Deduplication ------------------------------------------------------
  const { deduped: dedupedCandidates, warnings: dedupWarnings } =
    deduplicateDataCandidates(dataReqResult.dataCandidates);
  allWarnings.push(...dedupWarnings);

  // ---- Assign deterministic IDs -------------------------------------------
  const tempIdToFinalId = new Map<string, string>();
  const dataItems: TestDataItem[] = [];

  // Group candidates by dedup key to find which test cases share items
  const candidateTCMap = new Map<string, string[]>(); // tempId → testCaseIds
  for (const c of dataReqResult.dataCandidates) {
    const ids = candidateTCMap.get(c.temporaryId) ?? [];
    if (!ids.includes(c.testCaseId)) ids.push(c.testCaseId);
    candidateTCMap.set(c.temporaryId, ids);
  }

  for (const c of dedupedCandidates) {
    const id = `DATA-${String(dataItems.length + 1).padStart(4, '0')}`;
    tempIdToFinalId.set(c.temporaryId, id);

    // Collect all test case IDs that reference this data item
    const relatedTCIds = candidateTCMap.get(c.temporaryId) ?? [c.testCaseId];

    dataItems.push({
      id,
      name: c.name,
      description: c.description,
      type: c.type,
      lifecycle: c.lifecycle,
      strategy: c.strategy,
      constraints: c.constraints.map((con) => ({
        type: con.type as DataConstraintType,
        field: con.field,
        operator: con.operator,
        value: con.value,
        description: con.description,
        provenance: [],
      })),
      dependencies: [],
      relatedTestCaseIds: relatedTCIds.filter((tcId) => validTCIds.has(tcId)),
      relatedRequirementIds: c.relatedRequirementIds,
      relatedEntityIds: c.relatedEntityIds,
      setup: buildSetupIntents(c),
      cleanup: buildCleanupIntents(c),
      provenance: c.provenance,
      confidence: c.confidence,
    });
  }

  // ---- Build dependency graph ---------------------------------------------
  const depCandidates = depResult.dependencyCandidates
    .filter((d) => tempIdToFinalId.has(d.sourceTemporaryId) && tempIdToFinalId.has(d.targetTemporaryId))
    .map((d) => ({
      sourceDataItemId: tempIdToFinalId.get(d.sourceTemporaryId)!,
      targetDataItemId: tempIdToFinalId.get(d.targetTemporaryId)!,
      type: d.type,
      description: d.description,
    }));

  const { dependencies, cycles } = buildDependencyGraph(depCandidates);

  // Warn about cycles
  for (const cycle of cycles) {
    allWarnings.push({
      code: TestDataPlannerWarningCode.DEPENDENCY_CYCLE,
      message: `Dependency cycle detected: ${cycle.join(' → ')}`,
    });
  }

  // Update data item dependency lists
  for (const dep of dependencies) {
    const target = dataItems.find((d) => d.id === dep.targetDataItemId);
    if (target && !target.dependencies.includes(dep.sourceDataItemId)) {
      target.dependencies.push(dep.sourceDataItemId);
    }
  }

  // ---- Build reusable data sets -------------------------------------------
  const reusableSets: ReusableDataSet[] = depResult.reuseCandidates
    .filter((r) => r.temporaryIds.every((id) => tempIdToFinalId.has(id)))
    .map((r, i) => ({
      id: `DATASET-${String(i + 1).padStart(4, '0')}`,
      name: `Reusable set ${i + 1}`,
      dataItemIds: r.temporaryIds.map((id) => tempIdToFinalId.get(id)!),
      applicableTestCaseIds: findApplicableTestCases(r.temporaryIds, dataReqResult.dataCandidates, tempIdToFinalId),
      reusePolicy: r.reusePolicy,
      reason: r.reason,
    }));

  // Warn about unsafe reuse
  for (const rs of reusableSets) {
    if (rs.reusePolicy === 'safe') {
      const items = rs.dataItemIds.map((id) => dataItems.find((d) => d.id === id)).filter(Boolean);
      const hasMutable = items.some((item) =>
        item && (item.strategy === 'create-new' || item.lifecycle === 'temporary')
      );
      if (hasMutable) {
        allWarnings.push({
          code: TestDataPlannerWarningCode.UNSAFE_REUSE,
          message: `Reusable set ${rs.id} marked safe but contains mutable data items`,
        });
      }
    }
  }

  // ---- Build unresolved ---------------------------------------------------
  const finalUnresolved: TestDataUnresolved[] = dataReqResult.unresolvedCandidates
    .map((u, i) => ({
      id: `DATA-UNRESOLVED-${String(i + 1).padStart(4, '0')}`,
      testCaseIds: u.testCaseIds.filter((id) => validTCIds.has(id)),
      description: u.description,
      reason: u.reason,
      provenance: u.provenance,
    }));

  // ---- Build per-test-case data plans -------------------------------------
  const testCasePlans: TestCaseDataPlan[] = [];
  for (const tc of testCases) {
    const requiredIds = dataItems
      .filter((d) => d.relatedTestCaseIds.includes(tc.id))
      .map((d) => d.id);

    const unresolvedIds = finalUnresolved
      .filter((u) => u.testCaseIds.includes(tc.id))
      .map((u) => u.id);

    const setupIds = requiredIds.filter((id) => {
      const item = dataItems.find((d) => d.id === id);
      return item && item.setup.some((s) => s.type !== 'none');
    });

    const cleanupIds = requiredIds.filter((id) => {
      const item = dataItems.find((d) => d.id === id);
      return item && item.cleanup.some((c) => c.type !== 'none');
    });

    const reusableIds = reusableSets
      .filter((rs) => rs.applicableTestCaseIds.includes(tc.id))
      .map((rs) => rs.id);

    testCasePlans.push({
      testCaseId: tc.id,
      requiredDataItemIds: requiredIds,
      setupItemIds: setupIds,
      cleanupItemIds: cleanupIds,
      reusableDataSetIds: reusableIds,
      unresolvedIds,
    });
  }

  // ---- Warn about unknown strategies --------------------------------------
  for (const item of dataItems) {
    if (item.strategy === 'unknown') {
      allWarnings.push({
        code: TestDataPlannerWarningCode.UNKNOWN_STRATEGY,
        message: `Data item ${item.id} has unknown strategy`,
        dataItemId: item.id,
      });
    }
  }

  // ---- Warn about partial plans -------------------------------------------
  for (const tcp of testCasePlans) {
    if (tcp.requiredDataItemIds.length === 0 && tcp.unresolvedIds.length > 0) {
      allWarnings.push({
        code: TestDataPlannerWarningCode.PARTIAL_PLAN,
        message: `Test case ${tcp.testCaseId} has no resolved data items`,
        testCaseId: tcp.testCaseId,
      });
    }
  }

  // ---- Final validation ---------------------------------------------------
  allWarnings.push(...validateTestCaseReferences(dataItems, validTCIds));
  allWarnings.push(...validateRequirementReferences(dataItems, new Set())); // Accept all req IDs from AI
  allWarnings.push(...validateProvenance(dataItems));

  // ---- Quality metrics ----------------------------------------------------
  const quality = computeDataQualityMetrics(
    testCasePlans, dataItems, dependencies, reusableSets, finalUnresolved, cycles.length,
  );

  // ---- Assemble final IR --------------------------------------------------
  const dataPlanIR: TestDataPlanIR = {
    schemaVersion: '1.0',
    testCases: testCasePlans,
    dataItems,
    dependencyGraph: dependencies,
    reusableSets,
    unresolved: finalUnresolved,
    quality,
  };

  // ---- Write output -------------------------------------------------------
  if (outputDir) {
    const manifest: TestDataPlannerManifest = {
      schemaVersion: '1.0',
      source: { testCaseIR: inputDir },
      provider: { name: provider.name, model: '' },
      promptVersion,
      stats: {
        testCases: testCasePlans.length,
        dataItems: dataItems.length,
        dependencies: dependencies.length,
        reusableSets: reusableSets.length,
        unresolved: finalUnresolved.length,
        completePlans: quality.testCasesWithCompleteDataPlan,
        partialPlans: quality.testCasesPartiallyPlanned,
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

    writeDataOutput(outputDir, dataPlanIR, manifest);
    writeDataIntermediate(outputDir, dataReqResult, depResult);
  }

  return dataPlanIR;
}

// ---- Helpers --------------------------------------------------------------

function buildSetupIntents(c: DataRequirementCandidate): Array<{
  type: 'select' | 'create' | 'generate' | 'configure' | 'mock' | 'derive' | 'none';
  description: string;
  executorHint?: 'database' | 'api' | 'ui' | 'file' | 'configuration' | 'unknown';
}> {
  const setupMap: Record<string, { type: 'select' | 'create' | 'generate' | 'configure' | 'mock' | 'derive' | 'none'; executorHint?: 'database' | 'api' | 'ui' | 'file' | 'configuration' | 'unknown' }> = {
    'reuse-existing': { type: 'select', executorHint: 'database' },
    'create-new': { type: 'create', executorHint: 'database' },
    'generate': { type: 'generate' },
    'derive': { type: 'derive' },
    'mock': { type: 'mock', executorHint: 'api' },
    'stub': { type: 'mock', executorHint: 'api' },
    'configure': { type: 'configure', executorHint: 'configuration' },
    'select-existing': { type: 'select', executorHint: 'database' },
    'unknown': { type: 'none' },
  };

  const setup = setupMap[c.strategy] ?? { type: 'none' as const };
  return [{ type: setup.type, description: `Setup: ${c.description}`, executorHint: setup.executorHint }];
}

function buildCleanupIntents(c: DataRequirementCandidate): Array<{
  type: 'delete' | 'restore' | 'reset' | 'expire' | 'none' | 'unknown';
  description: string;
}> {
  if (c.lifecycle === 'temporary') {
    return [{ type: 'delete', description: `Cleanup temporary data: ${c.name}` }];
  }
  if (c.lifecycle === 'generated' && c.strategy === 'create-new') {
    return [{ type: 'delete', description: `Cleanup generated data: ${c.name}` }];
  }
  return [{ type: 'none', description: 'No cleanup required' }];
}

function findApplicableTestCases(
  tempIds: string[],
  allCandidates: DataRequirementCandidate[],
  _tempIdToFinalId: Map<string, string>,
): string[] {
  const tcIds = new Set<string>();
  for (const tempId of tempIds) {
    const candidates = allCandidates.filter((c) => c.temporaryId === tempId);
    for (const c of candidates) {
      tcIds.add(c.testCaseId);
    }
  }
  return [...tcIds];
}
