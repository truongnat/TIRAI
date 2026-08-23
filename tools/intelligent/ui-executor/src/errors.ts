// UI Executor v1 — Error types.

import type { UIErrorCode } from './models.js';

export const UI_ERROR_CODES = new Set<UIErrorCode>([
  'UI_INVALID_TEST_CASE',
  'UI_BASE_URL_MISSING',
  'UI_ORIGIN_DENIED',
  'UI_LOCATOR_MAPPING_MISSING',
  'UI_ELEMENT_NOT_FOUND',
  'UI_LOCATOR_AMBIGUOUS',
  'UI_ELEMENT_NOT_VISIBLE',
  'UI_ELEMENT_DISABLED',
  'UI_ACTION_UNSUPPORTED',
  'UI_BINDING_MISSING',
  'UI_SECRET_RESOLUTION_FAILED',
  'UI_NAVIGATION_FAILED',
  'UI_NAVIGATION_TIMEOUT',
  'UI_ACTION_TIMEOUT',
  'UI_ASSERTION_FAILED',
  'UI_ASSERTION_UNVERIFIABLE',
  'UI_SCREENSHOT_FAILED',
  'UI_BROWSER_START_FAILED',
  'UI_BROWSER_CLOSED',
  'UI_UNEXPECTED_POPUP',
  'UI_INTERNAL_ERROR',
]);

export class UIExecutorError extends Error {
  readonly code: UIErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: UIErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'UIExecutorError';
    this.code = code;
    this.details = details;
  }
}
