// Project Adapter warnings — typed warning codes for profile diagnostics.

import type { ProjectAdapterWarning, ProjectAdapterWarningCode } from './models.js';

export function createWarning(
  code: ProjectAdapterWarningCode,
  message: string,
  path?: string,
): ProjectAdapterWarning {
  return { code, message, path };
}
