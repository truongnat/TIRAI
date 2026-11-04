import { describe, it, expect } from 'vitest';
import { TestDataPlannerError, TestDataPlannerErrorCode } from '../src/errors.js';
import { TestDataPlannerWarningCode, DATA_CONFIDENCE_THRESHOLD } from '../src/warnings.js';

describe('Test Data Planner Models & Errors', () => {
  it('instantiates TestDataPlannerError with code and message', () => {
    const err = new TestDataPlannerError(TestDataPlannerErrorCode.INVALID_TEST_CASE_IR, 'Invalid test case IR');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TestDataPlannerError');
    expect(err.code).toBe(TestDataPlannerErrorCode.INVALID_TEST_CASE_IR);
    expect(err.message).toBe('Invalid test case IR');
  });

  it('exposes warning codes and thresholds', () => {
    expect(TestDataPlannerWarningCode.MISSING_CONSTRAINT).toBe('DATA_MISSING_CONSTRAINT');
    expect(TestDataPlannerWarningCode.UNKNOWN_STRATEGY).toBe('DATA_UNKNOWN_STRATEGY');
    expect(DATA_CONFIDENCE_THRESHOLD.HIGH).toBe(0.8);
  });
});
