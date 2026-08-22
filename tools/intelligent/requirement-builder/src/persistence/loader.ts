// ---------------------------------------------------------------------------
// Semantic IR loader – reads from disk, validates structure
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import { RequirementBuilderError, RequirementErrorCode } from '../errors.js';
import type { SemanticIRInput } from '../models.js';

/**
 * Load a Semantic IR package from a directory containing semantic-ir.json.
 *
 * Validates that the file exists, is valid JSON, and has the expected
 * schema version.
 */
export function loadSemanticIR(inputDir: string): SemanticIRInput {
  const absDir = path.resolve(inputDir);

  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    throw new RequirementBuilderError(
      RequirementErrorCode.INPUT_NOT_FOUND,
      `Input directory not found: ${absDir}`,
    );
  }

  const irPath = path.join(absDir, 'semantic-ir.json');
  if (!fs.existsSync(irPath)) {
    throw new RequirementBuilderError(
      RequirementErrorCode.INPUT_NOT_FOUND,
      `semantic-ir.json not found in: ${absDir}`,
    );
  }

  let ir: SemanticIRInput;
  try {
    const raw = fs.readFileSync(irPath, 'utf-8');
    ir = JSON.parse(raw) as SemanticIRInput;
  } catch (err) {
    throw new RequirementBuilderError(
      RequirementErrorCode.INVALID_SEMANTIC_IR,
      `Failed to parse semantic-ir.json: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  validateSemanticIR(ir);
  return ir;
}

/**
 * Load the raw content of semantic-ir.json for fingerprinting.
 */
export function loadSemanticIRContent(inputDir: string): string {
  const absDir = path.resolve(inputDir);
  const irPath = path.join(absDir, 'semantic-ir.json');

  if (!fs.existsSync(irPath)) {
    throw new RequirementBuilderError(
      RequirementErrorCode.INPUT_NOT_FOUND,
      `semantic-ir.json not found in: ${absDir}`,
    );
  }

  return fs.readFileSync(irPath, 'utf-8');
}

/**
 * Validate the structural integrity of a Semantic IR input.
 */
function validateSemanticIR(ir: SemanticIRInput): void {
  if (!ir.schemaVersion) {
    throw new RequirementBuilderError(
      RequirementErrorCode.INVALID_SEMANTIC_IR,
      'Semantic IR missing schemaVersion',
    );
  }

  if (ir.schemaVersion !== '1.0') {
    throw new RequirementBuilderError(
      RequirementErrorCode.INVALID_SEMANTIC_IR,
      `Unsupported Semantic IR schema version: ${ir.schemaVersion} (expected "1.0")`,
    );
  }

  if (!ir.document || typeof ir.document !== 'object') {
    throw new RequirementBuilderError(
      RequirementErrorCode.INVALID_SEMANTIC_IR,
      'Semantic IR missing document',
    );
  }

  // Validate arrays exist (may be empty)
  const requiredArrays = ['sections', 'entities', 'flows', 'rules', 'relationships', 'unresolved'] as const;
  for (const key of requiredArrays) {
    if (!Array.isArray(ir[key])) {
      throw new RequirementBuilderError(
        RequirementErrorCode.INVALID_SEMANTIC_IR,
        `Semantic IR missing or invalid array: ${key}`,
      );
    }
  }

  // Validate each entity has id and name
  for (const e of ir.entities) {
    if (!e.id || !e.name) {
      throw new RequirementBuilderError(
        RequirementErrorCode.INVALID_SEMANTIC_IR,
        `Entity missing required fields: ${JSON.stringify(e)}`,
      );
    }
  }

  // Validate each flow has id, name, and steps array
  for (const f of ir.flows) {
    if (!f.id || !f.name || !Array.isArray(f.steps)) {
      throw new RequirementBuilderError(
        RequirementErrorCode.INVALID_SEMANTIC_IR,
        `Flow missing required fields: ${JSON.stringify(f)}`,
      );
    }
  }

  // Validate each rule has id and statement
  for (const r of ir.rules) {
    if (!r.id || !r.statement) {
      throw new RequirementBuilderError(
        RequirementErrorCode.INVALID_SEMANTIC_IR,
        `Rule missing required fields: ${JSON.stringify(r)}`,
      );
    }
  }
}
