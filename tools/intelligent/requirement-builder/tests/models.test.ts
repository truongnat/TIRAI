import { describe, it, expect } from 'vitest';
import { RequirementBuilderError } from '../src/errors.js';
import { RequirementWarningCode, CONFIDENCE_THRESHOLD } from '../src/warnings.js';

describe('Requirement Builder Models & Errors', () => {
  it('instantiates RequirementBuilderError with code and details', () => {
    const err = new RequirementBuilderError('INVALID_INPUT', 'Invalid requirement input data');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('RequirementBuilderError');
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.message).toContain('Invalid requirement input data');
  });

  it('exposes requirement warning codes and confidence thresholds', () => {
    expect(RequirementWarningCode.LOW_CONFIDENCE).toBe('REQUIREMENT_LOW_CONFIDENCE');
    expect(RequirementWarningCode.NOT_TESTABLE).toBe('REQUIREMENT_NOT_TESTABLE');
    expect(CONFIDENCE_THRESHOLD.HIGH).toBe(0.8);
    expect(CONFIDENCE_THRESHOLD.MEDIUM).toBe(0.5);
  });
});
