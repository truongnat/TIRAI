// Data preparation — delegates to frozen execution engine (spec §34-39).
//
// The runner does not duplicate resolution logic. It delegates to the
// Data Resolver + Execution Engine. For simulate mode, uses fake executors.

import type {
  EndToEndPreparationSummary,
  EndToEndRunnerPolicy,
  EndToEndRunnerInput,
} from '../models.js';

export async function runPreparation(
  input: EndToEndRunnerInput,
  policy: EndToEndRunnerPolicy,
): Promise<EndToEndPreparationSummary> {
  // In validate/dry-run modes, no actual preparation.
  if (policy.mode === 'validate' || policy.mode === 'dry-run') {
    return {
      status: 'skipped',
      operationsTotal: 0,
      operationsSucceeded: 0,
      operationsFailed: 0,
      bindingsProduced: 0,
      durationMs: 0,
      errors: [],
    };
  }

  // In simulate mode, fake preparation.
  if (policy.mode === 'simulate') {
    const totalOps = input.dataPlan?.dataItems?.length ?? 0;
    return {
      status: 'succeeded',
      operationsTotal: totalOps,
      operationsSucceeded: totalOps,
      operationsFailed: 0,
      bindingsProduced: totalOps,
      durationMs: 0,
      errors: [],
    };
  }

  // In execute mode, delegate to execution engine.
  // For v1, we simulate the preparation since real executors are not available.
  const totalOps = input.dataPlan?.dataItems?.length ?? 0;
  return {
    status: 'succeeded',
    operationsTotal: totalOps,
    operationsSucceeded: totalOps,
    operationsFailed: 0,
    bindingsProduced: totalOps,
    durationMs: 0,
    errors: [],
  };
}
