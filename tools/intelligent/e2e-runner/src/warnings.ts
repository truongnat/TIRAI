// Runner warning helper — creates structured warnings.

import type { RunnerWarning, RunnerWarningCode } from './models.js';

export function createWarning(
  code: RunnerWarningCode,
  message: string,
  path?: string,
): RunnerWarning {
  return { code, message, path };
}
