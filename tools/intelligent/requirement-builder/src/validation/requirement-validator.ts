// ---------------------------------------------------------------------------
// Requirement validator – structural validation of final requirements
// ---------------------------------------------------------------------------

import type { Requirement, RequirementWarning } from '../models.js';
import { RequirementWarningCode, CONFIDENCE_THRESHOLD } from '../warnings.js';

const VALID_TYPES: ReadonlySet<string> = new Set<string>([
  'functional', 'validation', 'business-rule', 'data', 'interface',
  'security', 'state-transition', 'non-functional', 'technical-constraint', 'unknown',
]);

const VALID_SOURCE_NATURES: ReadonlySet<string> = new Set<string>([
  'explicit', 'derived', 'ambiguous',
]);

const VALID_TESTABILITY: ReadonlySet<string> = new Set<string>([
  'testable', 'partially-testable', 'not-testable', 'unknown',
]);

/**
 * Validate a single requirement's structural integrity.
 */
export function validateRequirement(
  req: Requirement,
  validSemanticIds: Set<string>,
): RequirementWarning[] {
  const warnings: RequirementWarning[] = [];

  // Check required fields
  if (!req.id) warnings.push({ code: 'REQUIREMENT_INVALID', message: 'Requirement missing id', requirementId: req.id });
  if (!req.title) warnings.push({ code: 'REQUIREMENT_INVALID', message: 'Requirement missing title', requirementId: req.id });
  if (!req.statement) warnings.push({ code: 'REQUIREMENT_INVALID', message: 'Requirement missing statement', requirementId: req.id });

  // Validate type
  if (!VALID_TYPES.has(req.type)) {
    warnings.push({
      code: 'REQUIREMENT_INVALID',
      message: `${req.id}: invalid type "${req.type}"`,
      requirementId: req.id,
    });
  }

  // Validate sourceNature
  if (!VALID_SOURCE_NATURES.has(req.sourceNature)) {
    warnings.push({
      code: 'REQUIREMENT_INVALID',
      message: `${req.id}: invalid sourceNature "${req.sourceNature}"`,
      requirementId: req.id,
    });
  }

  // Validate confidence range
  if (typeof req.confidence !== 'number' || req.confidence < 0 || req.confidence > 1) {
    warnings.push({
      code: 'REQUIREMENT_INVALID',
      message: `${req.id}: confidence out of range [0,1]: ${req.confidence}`,
      requirementId: req.id,
    });
  }

  // Validate testability
  if (!VALID_TESTABILITY.has(req.testability.status)) {
    warnings.push({
      code: 'REQUIREMENT_INVALID',
      message: `${req.id}: invalid testability status "${req.testability.status}"`,
      requirementId: req.id,
    });
  }

  // Low confidence warning
  if (req.confidence < CONFIDENCE_THRESHOLD.MEDIUM) {
    warnings.push({
      code: RequirementWarningCode.LOW_CONFIDENCE,
      message: `${req.id}: low confidence ${req.confidence}`,
      requirementId: req.id,
    });
  }

  // Entity-like detection: statements that look like inventory
  if (isEntityLike(req.statement)) {
    warnings.push({
      code: RequirementWarningCode.ENTITY_LIKE,
      message: `${req.id}: statement appears to be an entity inventory, not a requirement`,
      requirementId: req.id,
    });
  }

  // Non-atomicity detection: multiple independent behaviors joined by AND
  if (isNonAtomic(req)) {
    warnings.push({
      code: RequirementWarningCode.NON_ATOMIC,
      message: `${req.id}: statement contains multiple independent obligations`,
      requirementId: req.id,
    });
  }

  // Not testable warning
  if (req.testability.status === 'not-testable') {
    warnings.push({
      code: RequirementWarningCode.NOT_TESTABLE,
      message: `${req.id}: requirement is not testable`,
      requirementId: req.id,
    });
  }

  // Validate semantic references
  for (const sid of req.relatedSemanticIds) {
    if (!validSemanticIds.has(sid)) {
      warnings.push({
        code: RequirementWarningCode.DANGLING_SEMANTIC_REF,
        message: `${req.id}: dangling semantic reference "${sid}"`,
        requirementId: req.id,
      });
    }
  }

  // Validate provenance is non-empty
  if (req.provenance.length === 0) {
    warnings.push({
      code: RequirementWarningCode.INVALID_PROVENANCE,
      message: `${req.id}: requirement has no provenance`,
      requirementId: req.id,
    });
  }

  return warnings;
}

/**
 * Detect statements that look like entity inventory rather than requirements.
 *
 * Heuristic: "System shall have X" or "System shall provide X" where X is
 * a single noun phrase without verbs.
 */
function isEntityLike(statement: string): boolean {
  const lower = statement.toLowerCase().trim();
  // Match patterns like "system shall have <noun>" or "system shall provide <noun>"
  const havePattern = /^(the system|system) (shall |must |will )(have|provide|contain|include)\s+\w+$/;
  return havePattern.test(lower);
}

/**
 * Detect non-atomic requirements by looking for multiple independent
 * behavior verbs joined by "and".
 */
function isNonAtomic(req: Requirement): boolean {
  // If there are multiple expected behaviors with no shared condition,
  // that's fine — they're structured separately. Only warn if the
  // statement itself contains many independent verbs.
  const behaviorCount = req.expectedBehaviors.length;
  if (behaviorCount <= 1) return false;

  // Check if behaviors are truly independent (different targets, no shared condition)
  const targets = new Set(req.expectedBehaviors.map((b) => b.target ?? '').filter(Boolean));
  const conditions = new Set(req.expectedBehaviors.map((b) => b.condition ?? '').filter(Boolean));

  // Multiple unrelated targets without shared conditions suggest non-atomicity
  return targets.size >= 3 && conditions.size === 0;
}
