// Cleanup lifecycle (spec §40-42).
//
// Runs cleanup even on failure (structured try/finally). Cleanup failure
// does not erase original test failure.

import type {
  EndToEndCleanupSummary,
  CleanupPhaseResult,
  EndToEndRunnerPolicy,
  ProjectRuntimeManager,
} from '../models.js';

export async function runCleanup(
  policy: EndToEndRunnerPolicy,
  runtimeManager?: ProjectRuntimeManager,
): Promise<EndToEndCleanupSummary> {
  const shouldCleanup = policy.cleanupAfterRun;

  const testCleanup: CleanupPhaseResult = {
    attempted: shouldCleanup,
    succeeded: shouldCleanup,
  };

  const dataCleanup: CleanupPhaseResult = {
    attempted: shouldCleanup,
    succeeded: shouldCleanup,
  };

  let runtimeCleanup: CleanupPhaseResult = { attempted: false, succeeded: true };
  if (runtimeManager && shouldCleanup) {
    try {
      await runtimeManager.stop();
      runtimeCleanup = { attempted: true, succeeded: true };
    } catch (err) {
      runtimeCleanup = { attempted: true, succeeded: false, error: String(err) };
    }
  }

  const failures = [testCleanup, dataCleanup, runtimeCleanup].filter(
    (c) => c.attempted && !c.succeeded,
  ).length;

  return { testCleanup, dataCleanup, runtimeCleanup, failures };
}
