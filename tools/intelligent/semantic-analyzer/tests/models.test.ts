import { describe, it, expect } from 'vitest';
import { SemanticAnalyzerError, SemanticErrorCode } from '../src/errors.js';

describe('Semantic Analyzer Models & Errors', () => {
  it('instantiates SemanticAnalyzerError with code and message', () => {
    const err = new SemanticAnalyzerError(SemanticErrorCode.INVALID_CONTEXT, 'Context cannot be parsed');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SemanticAnalyzerError');
    expect(err.code).toBe(SemanticErrorCode.INVALID_CONTEXT);
    expect(err.message).toBe('Context cannot be parsed');
  });

  it('exposes all semantic error codes', () => {
    expect(SemanticErrorCode.INPUT_NOT_FOUND).toBe('SEMANTIC_INPUT_NOT_FOUND');
    expect(SemanticErrorCode.SCHEMA_FAILURE).toBe('SEMANTIC_SCHEMA_FAILURE');
  });
});
