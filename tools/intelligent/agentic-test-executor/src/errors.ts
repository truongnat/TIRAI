// ---------------------------------------------------------------------------
// Agentic Test Executor — errors
// ---------------------------------------------------------------------------

import type { AgenticFailureCode } from './models.js';

export class AgenticExecutorError extends Error {
  readonly code: AgenticFailureCode;

  constructor(code: AgenticFailureCode, message: string) {
    super(message);
    this.name = 'AgenticExecutorError';
    this.code = code;
  }
}

export function isAgenticError(err: unknown): err is AgenticExecutorError {
  return err instanceof AgenticExecutorError;
}
