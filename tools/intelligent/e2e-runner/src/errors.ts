// Runner error class — structured error with code and optional path.

import type { RunnerErrorCode } from './models.js';

export class EndToEndRunnerError extends Error {
  readonly code: RunnerErrorCode;
  readonly path?: string;

  constructor(code: RunnerErrorCode, message: string, path?: string) {
    super(message);
    this.name = 'EndToEndRunnerError';
    this.code = code;
    this.path = path;
  }
}
