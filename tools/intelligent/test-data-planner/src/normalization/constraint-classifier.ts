// ---------------------------------------------------------------------------
// Constraint classifier — deterministic type inference from descriptions
// ---------------------------------------------------------------------------
// Classifies constraint descriptions into canonical DataConstraintType values
// where the mapping is unambiguous.  Operates only on DataConstraint context,
// not arbitrary document prose.
//
// Accuracy over classification rate: vague or ambiguous descriptions remain
// type = "other".
// ---------------------------------------------------------------------------

import type { DataConstraint, DataConstraintType } from '../models.js';

// ---- Pattern table --------------------------------------------------------
// Each entry: [regex, canonicalType]
// Order matters: first match wins.  Patterns are case-insensitive.

const CONSTRAINT_PATTERNS: ReadonlyArray<[RegExp, DataConstraintType]> = [
  // Required / not-null
  [/\b(?:required|must be provided|must be supplied|must not be null|not null|not nullable|cannot be null|cannot be empty)\b/i, 'required'],

  // Nullable (explicit allowance)
  [/\b(?:nullable|allows? null|permit(?:s|ted)? null|may be null|can be null|allow(?:s|ed)? null)\b/i, 'nullable'],

  // Unique
  [/\bunique\b/i, 'unique'],

  // Foreign key
  [/\b(?:foreign\s*key|references?\s+\w+)\b/i, 'foreign-key'],

  // Length (explicit value) — must come before min/max to avoid false match
  [/\b(?:max(?:imum)?\s+length|length\s*(?:of)?\s*\d+|min(?:imum)?\s+length)\s*(?:=|:|is|of)?\s*(\d+(?:\.\d+)?)\b/i, 'length'],

  // Numeric min (explicit value) — allows optional words between keyword and number
  [/\b(?:minimum|min)\b[\w\s]*?(?:=|:|is|of)\s*(\d+(?:\.\d+)?)\b/i, 'min'],

  // Numeric max (explicit value) — allows optional words between keyword and number
  [/\b(?:maximum|max)\b[\w\s]*?(?:=|:|is|of)\s*(\d+(?:\.\d+)?)\b/i, 'max'],

  // Format
  [/\b(?:format|pattern|regex|must match|must be in format|email format|phone format|JWT format|ISO\s*\d{4})\b/i, 'format'],

  // State
  [/\b(?:status|state|must be in state|lifecycle)\b/i, 'state'],
];

/**
 * Classify a constraint description into a canonical type.
 * Returns 'other' if no safe deterministic match is found.
 */
export function classifyConstraintType(description: string): DataConstraintType {
  if (!description || description.trim().length === 0) return 'other';

  for (const [pattern, type] of CONSTRAINT_PATTERNS) {
    if (pattern.test(description)) {
      return type;
    }
  }

  return 'other';
}

/**
 * Extract a numeric value from a constraint description if unambiguous.
 * Returns undefined if parsing would be speculative.
 */
export function extractNumericValue(description: string, type: 'min' | 'max' | 'length'): number | undefined {
  let pattern: RegExp;
  switch (type) {
    case 'length':
      pattern = /\b(?:max(?:imum)?\s+length|length)\s*(?:=|:|is|of)?\s*(\d+(?:\.\d+)?)\b/i;
      break;
    case 'min':
      pattern = /\b(?:minimum|min)\b[\w\s]*?(?:=|:|is|of)\s*(\d+(?:\.\d+)?)\b/i;
      break;
    case 'max':
      pattern = /\b(?:maximum|max)\b[\w\s]*?(?:=|:|is|of)\s*(\d+(?:\.\d+)?)\b/i;
      break;
  }
  const match = description.match(pattern);
  if (!match?.[1]) return undefined;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Apply deterministic constraint classification to an array of constraints.
 * Only upgrades constraints with type = 'other' — never downgrades.
 * Returns a new array (does not mutate input).
 */
export function classifyConstraints(constraints: ReadonlyArray<DataConstraint>): DataConstraint[] {
  return constraints.map((c) => {
    if (c.type !== 'other') return { ...c };

    const classified = classifyConstraintType(c.description);
    if (classified === 'other') return { ...c };

    const result: DataConstraint = {
      ...c,
      type: classified,
    };

    // Extract numeric value where applicable
    if (classified === 'min' || classified === 'max' || classified === 'length') {
      const value = extractNumericValue(c.description, classified);
      if (value !== undefined) {
        result.value = value;
      }
    }

    return result;
  });
}
