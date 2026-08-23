// ---------------------------------------------------------------------------
// Test Data Planner – input loader
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TestCaseIRInput, TestPlanIRInput } from '../models.js';
import { TestDataPlannerError, TestDataPlannerErrorCode } from '../errors.js';

/**
 * Load and parse Test Case IR from a directory.
 */
export function loadTestCaseIR(inputDir: string): TestCaseIRInput {
  const resolvedDir = path.resolve(inputDir);
  const filePath = path.join(resolvedDir, 'test-case-ir.json');

  if (!fs.existsSync(filePath)) {
    throw new TestDataPlannerError(
      TestDataPlannerErrorCode.INPUT_NOT_FOUND,
      `Test Case IR not found at: ${filePath}`,
    );
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as TestCaseIRInput;
    validateTestCaseIRStructure(parsed);
    return parsed;
  } catch (err) {
    if (err instanceof TestDataPlannerError) throw err;
    throw new TestDataPlannerError(
      TestDataPlannerErrorCode.INVALID_TEST_CASE_IR,
      `Failed to parse Test Case IR: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

/**
 * Load Test Plan IR (optional, for enrichment).
 */
export function loadTestPlanIR(inputDir: string): TestPlanIRInput | undefined {
  const resolvedDir = path.resolve(inputDir);
  const filePath = path.join(resolvedDir, 'test-plan-ir.json');

  if (!fs.existsSync(filePath)) return undefined;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as TestPlanIRInput;
  } catch {
    return undefined;
  }
}

/**
 * Load raw Test Case IR content for fingerprinting.
 */
export function loadTestCaseIRContent(inputDir: string): string {
  const resolvedDir = path.resolve(inputDir);
  const filePath = path.join(resolvedDir, 'test-case-ir.json');

  if (!fs.existsSync(filePath)) {
    throw new TestDataPlannerError(
      TestDataPlannerErrorCode.INPUT_NOT_FOUND,
      `Test Case IR not found at: ${filePath}`,
    );
  }

  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Load raw Test Plan IR content for fingerprinting (optional).
 */
export function loadTestPlanIRContent(inputDir: string): string | undefined {
  const resolvedDir = path.resolve(inputDir);
  const filePath = path.join(resolvedDir, 'test-plan-ir.json');

  if (!fs.existsSync(filePath)) return undefined;
  return fs.readFileSync(filePath, 'utf-8');
}

function validateTestCaseIRStructure(ir: TestCaseIRInput): void {
  if (ir.schemaVersion !== '1.0') {
    throw new TestDataPlannerError(
      TestDataPlannerErrorCode.INVALID_TEST_CASE_IR,
      `Unsupported schema version: ${ir.schemaVersion}`,
    );
  }
  if (!Array.isArray(ir.testCases)) {
    throw new TestDataPlannerError(
      TestDataPlannerErrorCode.INVALID_TEST_CASE_IR,
      'Test Case IR must contain a testCases array',
    );
  }
}
