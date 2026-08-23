// ---------------------------------------------------------------------------
// Test Planner – input loader
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RequirementIRInput } from '../models.js';
import { TestPlannerError, TestPlannerErrorCode } from '../errors.js';

/**
 * Load and parse Requirement IR from a directory.
 */
export function loadRequirementIR(inputDir: string): RequirementIRInput {
  const resolvedDir = path.resolve(inputDir);

  // Try requirement-ir.json first
  const filePath = path.join(resolvedDir, 'requirement-ir.json');
  if (!fs.existsSync(filePath)) {
    throw new TestPlannerError(
      TestPlannerErrorCode.INPUT_NOT_FOUND,
      `Requirement IR not found at: ${filePath}`,
    );
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as RequirementIRInput;
    validateStructure(parsed);
    return parsed;
  } catch (err) {
    if (err instanceof TestPlannerError) throw err;
    throw new TestPlannerError(
      TestPlannerErrorCode.INVALID_REQUIREMENT_IR,
      `Failed to parse Requirement IR: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

/**
 * Load the raw Requirement IR content for fingerprinting.
 */
export function loadRequirementIRContent(inputDir: string): string {
  const filePath = path.join(path.resolve(inputDir), 'requirement-ir.json');
  if (!fs.existsSync(filePath)) {
    throw new TestPlannerError(
      TestPlannerErrorCode.INPUT_NOT_FOUND,
      `Requirement IR not found at: ${filePath}`,
    );
  }
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Basic structural validation of Requirement IR.
 */
function validateStructure(ir: RequirementIRInput): void {
  if (ir.schemaVersion !== '1.0') {
    throw new TestPlannerError(
      TestPlannerErrorCode.INVALID_REQUIREMENT_IR,
      `Unsupported schema version: ${ir.schemaVersion}`,
    );
  }
  if (!Array.isArray(ir.requirements)) {
    throw new TestPlannerError(
      TestPlannerErrorCode.INVALID_REQUIREMENT_IR,
      'Requirement IR must contain a requirements array',
    );
  }
  if (!ir.document || !Array.isArray(ir.document.provenance)) {
    throw new TestPlannerError(
      TestPlannerErrorCode.INVALID_REQUIREMENT_IR,
      'Requirement IR must contain a document with provenance',
    );
  }
}
