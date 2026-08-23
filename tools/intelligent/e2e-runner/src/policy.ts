// Runner policy — safety gates and execution controls.
//
// The policy enforces the triple-gate for execution: mode == execute AND
// allowExecution AND profile safety permits it. Production execute is
// always denied in v1.

import type {
  EndToEndRunnerPolicy,
  EndToEndRunMode,
  EnvironmentSafety,
  RunnerBlocker,
} from './models.js';

// ---- Default policy (spec §6, §79) ----------------------------------------

export function defaultPolicy(overrides?: Partial<EndToEndRunnerPolicy>): EndToEndRunnerPolicy {
  return {
    mode: 'dry-run',
    allowExecution: false,
    allowDatabaseMutation: false,
    allowApiMutation: false,
    allowBrowserExecution: false,
    allowCommands: false,
    failFast: false,
    maxConcurrency: 1,
    cleanupAfterRun: true,
    cleanupOnFailure: true,
    collectEvidence: true,
    environmentAllowlist: [],
    ...overrides,
  };
}

// ---- Execution gate (spec §11) --------------------------------------------

export function checkExecutionGate(
  policy: EndToEndRunnerPolicy,
  safety: EnvironmentSafety,
): RunnerBlocker | null {
  // Production: always deny execute (spec §14).
  if (safety === 'production' && policy.mode === 'execute') {
    return {
      code: 'RUNNER_PRODUCTION_EXECUTE_DENIED',
      message: 'Execute mode is denied for production environments',
      path: 'environment.safety',
    };
  }

  // Mode must be execute.
  if (policy.mode !== 'execute') return null;

  // Explicit allowExecution flag required.
  if (!policy.allowExecution) {
    return {
      code: 'RUNNER_POLICY_CONFLICT',
      message: 'Execute mode requires allowExecution=true',
      path: 'policy.allowExecution',
    };
  }

  // Environment allowlist check.
  if (policy.environmentAllowlist.length > 0) {
    // Allowlist is checked at a higher level with environment ID.
  }

  return null;
}

// ---- Mutation gate (spec §12) ---------------------------------------------

export function checkDatabaseMutationGate(policy: EndToEndRunnerPolicy): RunnerBlocker | null {
  if (policy.mode === 'execute' && !policy.allowDatabaseMutation) {
    return {
      code: 'RUNNER_POLICY_CONFLICT',
      message: 'Execute mode requires allowDatabaseMutation=true for DB mutations',
      path: 'policy.allowDatabaseMutation',
    };
  }
  return null;
}

export function checkApiMutationGate(policy: EndToEndRunnerPolicy): RunnerBlocker | null {
  if (policy.mode === 'execute' && !policy.allowApiMutation) {
    return {
      code: 'RUNNER_POLICY_CONFLICT',
      message: 'Execute mode requires allowApiMutation=true for API mutations',
      path: 'policy.allowApiMutation',
    };
  }
  return null;
}

export function checkBrowserGate(policy: EndToEndRunnerPolicy): RunnerBlocker | null {
  if (policy.mode === 'execute' && !policy.allowBrowserExecution) {
    return {
      code: 'RUNNER_POLICY_CONFLICT',
      message: 'Execute mode requires allowBrowserExecution=true for browser execution',
      path: 'policy.allowBrowserExecution',
    };
  }
  return null;
}

export function checkCommandGate(policy: EndToEndRunnerPolicy): RunnerBlocker | null {
  if (policy.mode === 'execute' && !policy.allowCommands) {
    return {
      code: 'RUNNER_POLICY_CONFLICT',
      message: 'Execute mode requires allowCommands=true for command execution',
      path: 'policy.allowCommands',
    };
  }
  return null;
}

// ---- Mode validation (spec §6-10) -----------------------------------------

export function isValidMode(mode: string): mode is EndToEndRunMode {
  return ['validate', 'dry-run', 'simulate', 'execute'].includes(mode);
}

// ---- Shared-nonprod check (spec §15) --------------------------------------

export function isSharedNonprodRestricted(safety: EnvironmentSafety): boolean {
  return safety === 'shared-nonprod';
}

// ---- Max tests enforcement (spec §27) -------------------------------------

export function enforceMaxTests(
  policyMax: number | undefined,
  cliMax: number | undefined,
): number | undefined {
  if (policyMax === undefined && cliMax === undefined) return undefined;
  const p = policyMax ?? Infinity;
  const c = cliMax ?? Infinity;
  return Math.min(p, c);
}
