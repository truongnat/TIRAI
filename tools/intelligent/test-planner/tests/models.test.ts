import { describe, it, expect } from 'vitest';
import { TestPlannerError, TestPlannerErrorCode } from '../src/errors.js';
import { TestPlannerWarningCode, TEST_CONFIDENCE_THRESHOLD } from '../src/warnings.js';

describe('Test Planner Models & Errors', () => {
  it('instantiates TestPlannerError with code and message', () => {
    const err = new TestPlannerError(TestPlannerErrorCode.INVALID_REQUIREMENTS, 'Requirements are invalid');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TestPlannerError');
    expect(err.code).toBe(TestPlannerErrorCode.INVALID_REQUIREMENTS);
    expect(err.message).toBe('Requirements are invalid');
  });

  it('exposes warning codes and confidence thresholds', () => {
    expect(TestPlannerWarningCode.REQUIREMENT_NOT_COVERED).toBe('TEST_REQUIREMENT_NOT_COVERED');
    expect(TestPlannerWarningCode.CASE_LOW_CONFIDENCE).toBe('TEST_CASE_LOW_CONFIDENCE');
    expect(TEST_CONFIDENCE_THRESHOLD.HIGH).toBe(0.8);
  });
});
