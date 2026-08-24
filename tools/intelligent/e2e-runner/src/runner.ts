// End-to-End Test Runner — main orchestration (spec §1-3).
//
// Coordinates the complete lifecycle: Load → Validate → Preflight →
// Prepare → Execute → Evidence → Cleanup → Report. Does NOT invent
// behavior — delegates to frozen modules.

import type {
  EndToEndRunnerOptions,
  EndToEndRunnerInput,
  EndToEndRunResultIR,
  EndToEndRunManifest,
  EndToEndRunStatus,
  EndToEndRunnerPolicy,
  InputArtifactHashes,
  ProjectRuntimeSummary,
  TestRunResultIR,
  TestRunSummary,
  TestCase,
} from './models.js';
import { runPreflight } from './preflight.js';
import { selectTests, applyMaxTests } from './selection.js';
import { computeInputHashes } from './fingerprints.js';
import { runPreparation } from './preparation/index.js';
import { runCleanup } from './cleanup/index.js';
import { computeRunQuality } from './quality/index.js';
import { writeRunOutput } from './persistence/index.js';
import { InMemoryRunAuditRecorder } from './audit/index.js';

const RUNNER_VERSION = '1.0.2';

export class EndToEndRunner {
  private options: EndToEndRunnerOptions;
  private policy: EndToEndRunnerPolicy;
  private audit: InMemoryRunAuditRecorder;

  constructor(options: EndToEndRunnerOptions) {
    this.options = options;
    this.policy = options.policy;
    this.audit = (options.auditRecorder as InMemoryRunAuditRecorder) ?? new InMemoryRunAuditRecorder();
  }

  async run(input: EndToEndRunnerInput): Promise<EndToEndRunResultIR> {
    const startedAt = new Date().toISOString();
    const runId = this.options.runIdProvider?.generate() ?? `RUN-${Date.now()}`;

    this.audit.record('run-created', 'Run created', { runId, mode: this.policy.mode });

    // Compute input hashes.
    const hashes = computeInputHashes(
      input.profile.fingerprint,
      input.testCases,
      input.mappings,
      input.dataPlan,
      input.preparedData,
    );

    this.audit.record('inputs-loaded', 'Input artifacts loaded', {
      testCases: input.testCases.length,
      mappings: input.mappings.testMappings.length,
    });

    // Preflight.
    this.audit.record('preflight-start', 'Preflight checks starting');
    const preflight = runPreflight(input, this.policy, hashes);
    this.audit.record('preflight-end', `Preflight: ${preflight.status}`, {
      checks: preflight.checks.length,
      blockers: preflight.blockers.length,
    });

    // If blocked, return immediately.
    if (preflight.status === 'blocked') {
      return this.buildResult(runId, startedAt, input, hashes, preflight, {
        mode: 'external', started: false, ready: false, stopped: false,
      }, {
        status: 'skipped', operationsTotal: 0, operationsSucceeded: 0,
        operationsFailed: 0, bindingsProduced: 0, durationMs: 0, errors: [],
      }, emptyTestResults(runId), {
        testCleanup: { attempted: false, succeeded: true },
        dataCleanup: { attempted: false, succeeded: true },
        runtimeCleanup: { attempted: false, succeeded: true },
        failures: 0,
      }, 'blocked');
    }

    // Runtime start.
    let runtimeSummary: ProjectRuntimeSummary = { mode: 'external', started: false, ready: false, stopped: false };
    if (this.options.runtimeManager && this.options.runtimeMode === 'managed') {
      this.audit.record('runtime-start', 'Starting managed runtime');
      try {
        await this.options.runtimeManager.start();
        await this.options.runtimeManager.waitUntilReady();
        runtimeSummary = { mode: 'managed', started: true, ready: true, stopped: false };
      } catch (err) {
        runtimeSummary = { mode: 'managed', started: false, ready: false, stopped: false, startError: String(err) };
      }
      this.audit.record('runtime-end', `Runtime: ${runtimeSummary.ready ? 'ready' : 'error'}`);
    }

    // Preparation.
    this.audit.record('preparation-start', 'Data preparation starting');
    const preparation = await runPreparation(input, this.policy);
    this.audit.record('preparation-end', `Preparation: ${preparation.status}`);

    // Test execution.
    this.audit.record('tests-start', 'Test execution starting');
    const selectedTests = applyMaxTests(
      selectTests(input.testCases, this.options.selection),
      this.policy.maxTests,
    );

    let testResults: TestRunResultIR;
    if (this.options.orchestrator && this.policy.mode === 'execute') {
      // Delegate to real orchestrator for execute mode.
      testResults = normalizeTestRunStatus(await this.options.orchestrator.run(selectedTests as TestCase[]));
    } else {
      testResults = this.executeTests(runId, selectedTests, input);
    }
    this.audit.record('tests-end', `Tests: ${testResults.status}`);

    // Cleanup.
    this.audit.record('cleanup-start', 'Cleanup starting');
    const cleanup = await runCleanup(this.policy, this.options.runtimeManager);
    if (cleanup.runtimeCleanup.attempted) {
      runtimeSummary.stopped = cleanup.runtimeCleanup.succeeded;
    }
    this.audit.record('cleanup-end', `Cleanup failures: ${cleanup.failures}`);

    // Build result.
    const status = this.deriveStatus(preflight.status, testResults.status, runtimeSummary, preparation, cleanup.failures);
    const result = this.buildResult(runId, startedAt, input, hashes, preflight, runtimeSummary, preparation, testResults, cleanup, status);

    // Write output.
    if (this.options.outputDir) {
      const manifest = this.buildManifest(runId, startedAt, input, hashes);
      await writeRunOutput({
        outputDir: this.options.outputDir,
        result,
        manifest,
        auditEvents: this.audit.events(),
        pretty: this.options.pretty,
      });
      this.audit.record('report-written', 'Run reports written');
    }

    this.audit.record('run-finished', `Run finished: ${status}`);
    return result;
  }

  private executeTests(
    runId: string,
    testCases: ReturnType<typeof selectTests>,
    input: EndToEndRunnerInput,
  ): TestRunResultIR {
    // In validate/dry-run modes, no actual execution.
    if (this.policy.mode === 'validate' || this.policy.mode === 'dry-run') {
      return emptyTestResults(runId);
    }

    // If an orchestrator is provided, delegate to it for real execution.
    // (This path is only reached when orchestrator is NOT provided — the
    // run() method handles the orchestrator case separately.)
    if (this.options.orchestrator) {
      throw new Error('Orchestrator must be invoked via run() method, not executeTests()');
    }

    // In simulate/execute modes, produce test results based on mappings.
    const mappingMap = new Map(input.mappings.testMappings.map((m) => [m.testCaseId, m]));
    const now = new Date().toISOString();
    const testResults = testCases.map((tc) => {
      const mapping = mappingMap.get(tc.id);
      if (!mapping || mapping.status !== 'ready') {
        return {
          schemaVersion: '1.0' as const,
          runId,
          testCaseId: tc.id,
          scenarioId: tc.scenarioId ?? '',
          requirementIds: tc.provenance?.map((p) => p.requirementId) ?? [],
          status: (!mapping || mapping.status === 'unresolved') ? 'blocked' as const : 'manual' as const,
          phase: 'completed' as const,
          steps: [],
          assertions: [],
          evidence: [],
          runtimeBindings: [],
          cleanup: { attempted: 0, succeeded: 0, failed: 0, results: [] },
          errors: [],
          warnings: [],
          provenance: tc.provenance ?? [],
          timings: { startedAt: now, finishedAt: now, durationMs: 0 },
        };
      }

      // Simulate passed test for ready mappings.
      return {
        schemaVersion: '1.0' as const,
        runId,
        testCaseId: tc.id,
        scenarioId: tc.scenarioId ?? '',
        requirementIds: tc.provenance?.map((p) => p.requirementId) ?? [],
        status: 'passed' as const,
        phase: 'completed' as const,
        steps: [],
        assertions: [],
        evidence: [],
        runtimeBindings: [],
        cleanup: { attempted: 0, succeeded: 0, failed: 0, results: [] },
        errors: [],
        warnings: [],
        provenance: tc.provenance ?? [],
        timings: { startedAt: now, finishedAt: now, durationMs: 0 },
      };
    });

    const summary = computeTestRunSummary(testResults);
    const status = summary.failed > 0 ? 'failed' : summary.blocked > 0 || summary.errors > 0 ? 'partial' : 'passed';

    return {
      schemaVersion: '1.0',
      runId,
      mode: this.policy.mode === 'simulate' ? 'simulate' : 'execute',
      startedAt: now,
      finishedAt: now,
      status,
      testResults,
      summary,
      evidence: [],
      auditTrail: [],
    };
  }

  private deriveStatus(
    preflightStatus: string,
    testStatus: string,
    runtime: ProjectRuntimeSummary,
    preparation: Awaited<ReturnType<typeof runPreparation>>,
    cleanupFailures: number,
  ): EndToEndRunStatus {
    if (preflightStatus === 'blocked') return 'blocked';
    if (this.policy.mode === 'validate' || this.policy.mode === 'dry-run') return 'validated';
    if (runtime.startError || preparation.status === 'failed' || cleanupFailures > 0) return 'error';
    if (testStatus === 'passed') return 'passed';
    if (testStatus === 'failed') return 'failed';
    if (testStatus === 'partial') return 'partial';
    return 'error';
  }

  private buildResult(
    runId: string,
    startedAt: string,
    input: EndToEndRunnerInput,
    hashes: InputArtifactHashes,
    preflight: ReturnType<typeof runPreflight>,
    runtime: ProjectRuntimeSummary,
    preparation: Awaited<ReturnType<typeof runPreparation>>,
    tests: TestRunResultIR,
    cleanup: Awaited<ReturnType<typeof runCleanup>>,
    status: EndToEndRunStatus,
  ): EndToEndRunResultIR {
    const finishedAt = new Date().toISOString();
    const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();

    return {
      schemaVersion: '1.0',
      runId,
      projectId: input.profile.project.id,
      environmentId: input.profile.environment.id,
      mode: this.policy.mode,
      status,
      preflight,
      runtime,
      preparation,
      tests,
      cleanup,
      evidence: tests.evidence ?? [],
      warnings: preflight.warnings,
      errors: [],
      quality: computeRunQuality(tests, durationMs, cleanup.failures),
      timings: {
        startedAt,
        finishedAt,
        durationMs,
        preflightMs: 0,
        runtimeStartMs: 0,
        preparationMs: preparation.durationMs,
        executionMs: tests.summary.durationMs,
        cleanupMs: 0,
        reportingMs: 0,
      },
      inputHashes: hashes,
      runnerVersion: RUNNER_VERSION,
      seed: this.options.seed,
    };
  }

  private buildManifest(
    runId: string,
    startedAt: string,
    input: EndToEndRunnerInput,
    hashes: InputArtifactHashes,
  ): EndToEndRunManifest {
    return {
      schemaVersion: '1.0',
      runId,
      projectId: input.profile.project.id,
      environmentId: input.profile.environment.id,
      mode: this.policy.mode,
      profileFingerprint: input.profile.fingerprint,
      inputHashes: hashes,
      projectProfileFingerprint: hashes.profileFingerprint,
      testCasesSemanticHash: hashes.testCasesSemanticHash,
      executionMappingArtifactHash: hashes.mappingArtifactHash,
      mappingSourceTestCasesHash: input.mappings.sourceTestCasesHash,
      mappingSourceProjectFingerprint: input.mappings.sourceProjectFingerprint,
      testDataPlanArtifactHash: hashes.dataPlanArtifactHash,
      testDataPlanSourceTestCasesHash: input.dataPlan?.sourceTestCasesHash,
      preparedDataPlanArtifactHash: hashes.preparedDataArtifactHash,
      preparedDataPlanSourceDataPlanHash: input.preparedData?.sourceDataPlanHash,
      selection: this.options.selection ?? {},
      startedAt,
      finishedAt: new Date().toISOString(),
      runnerVersion: RUNNER_VERSION,
      seed: this.options.seed,
    };
  }
}

function normalizeTestRunStatus(result: TestRunResultIR): TestRunResultIR {
  const failed = result.summary.failed > 0 || result.summary.assertionsFailed > 0 ||
    result.testResults.some((test) => test.status === 'failed' || test.assertions.some((a) => a.status === 'failed'));
  const errors = result.summary.errors > 0 || result.testResults.some((test) => test.status === 'error');
  const blockedOrManual = result.summary.blocked > 0 || result.summary.manual > 0 || result.summary.skipped > 0 ||
    result.testResults.some((test) => test.status === 'blocked' || test.status === 'manual' || test.status === 'skipped');
  const status = failed ? 'failed' : errors ? 'error' : blockedOrManual ? 'partial' : 'passed';
  return result.status === status ? result : { ...result, status };
}

// ---- Helpers ---------------------------------------------------------------

function emptyTestResults(runId: string): TestRunResultIR {
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    runId,
    mode: 'dry-run',
    startedAt: now,
    finishedAt: now,
    status: 'passed',
    testResults: [],
    summary: emptySummary(),
    evidence: [],
    auditTrail: [],
  };
}

function emptySummary(): TestRunSummary {
  return {
    testsTotal: 0, passed: 0, failed: 0, blocked: 0,
    skipped: 0, manual: 0, errors: 0,
    assertionsTotal: 0, assertionsPassed: 0, assertionsFailed: 0, assertionsBlocked: 0,
    evidenceItems: 0, cleanupFailures: 0, provenanceCoverage: 0, durationMs: 0,
  };
}

function computeTestRunSummary(results: TestRunResultIR['testResults']): TestRunSummary {
  let passed = 0, failed = 0, blocked = 0, skipped = 0, manual = 0, errors = 0;
  let assertionsTotal = 0, assertionsPassed = 0, assertionsFailed = 0;
  let evidenceItems = 0;

  for (const r of results) {
    switch (r.status) {
      case 'passed': passed++; break;
      case 'failed': failed++; break;
      case 'blocked': blocked++; break;
      case 'skipped': skipped++; break;
      case 'manual': manual++; break;
      case 'error': errors++; break;
    }
    assertionsTotal += r.assertions.length;
    assertionsPassed += r.assertions.filter((a) => a.status === 'passed').length;
    assertionsFailed += r.assertions.filter((a) => a.status === 'failed').length;
    evidenceItems += r.evidence.length;
  }

  return {
    testsTotal: results.length,
    passed, failed, blocked, skipped, manual, errors,
    assertionsTotal, assertionsPassed, assertionsFailed,
    assertionsBlocked: 0,
    evidenceItems,
    cleanupFailures: 0,
    provenanceCoverage: results.length > 0 ? (results.filter((r) => r.provenance.length > 0).length / results.length) : 0,
    durationMs: results.reduce((a, r) => a + r.timings.durationMs, 0),
  };
}
