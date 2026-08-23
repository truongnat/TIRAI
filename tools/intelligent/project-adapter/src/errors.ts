// Project Adapter errors — typed error class with error codes.

import type { ProjectAdapterErrorCode } from './models.js';

export class ProjectAdapterError extends Error {
  readonly code: ProjectAdapterErrorCode;
  readonly path?: string;

  constructor(code: ProjectAdapterErrorCode, message: string, path?: string) {
    super(message);
    this.name = 'ProjectAdapterError';
    this.code = code;
    this.path = path;
  }
}
