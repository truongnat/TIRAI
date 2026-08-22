// ---------------------------------------------------------------------------
// Requirement Builder – consolidation prompt
// ---------------------------------------------------------------------------
// Builds the user message for deduplication and conflict detection.

import type { RequirementCandidate } from '../models.js';

/**
 * Build the consolidation prompt for dedup + conflict detection.
 */
export function buildConsolidationPrompt(
  candidates: RequirementCandidate[],
): string {
  const parts: string[] = [];

  parts.push('# REQUIREMENT CONSOLIDATION');
  parts.push('');
  parts.push('Review the following requirement candidates for duplicates and conflicts.');
  parts.push('');

  // ---- Candidate summaries ----
  parts.push('## CANDIDATE SUMMARIES');
  for (const c of candidates) {
    parts.push(`${c.temporaryId}: [${c.type}] [${c.sourceNature}] ${c.statement}`);
    parts.push(`  Evidence: ${c.semanticEvidenceIds.join(', ')}`);
    parts.push(`  Confidence: ${c.confidence}`);
    if (c.actor) parts.push(`  Actor: ${c.actor}`);
    if (c.trigger) parts.push(`  Trigger: ${c.trigger}`);
    if (c.expectedBehaviors.length > 0) {
      parts.push(`  Behaviors: ${c.expectedBehaviors.map((b) => b.description).join('; ')}`);
    }
    parts.push('');
  }

  // ---- Tasks ----
  parts.push('## TASK 1: DUPLICATE DETECTION');
  parts.push('Identify candidates that describe the SAME system obligation.');
  parts.push('Signals:');
  parts.push('  - Same or very similar statement meaning');
  parts.push('  - Shared semantic evidence IDs');
  parts.push('  - Same actor + trigger + behavior');
  parts.push('  - Same type + provenance');
  parts.push('');
  parts.push('Do NOT merge candidates that describe different obligations.');
  parts.push('');

  parts.push('## TASK 2: CONFLICT DETECTION');
  parts.push('Identify candidates that contradict each other.');
  parts.push('Examples:');
  parts.push('  - One says required, another says optional');
  parts.push('  - Conflicting constraints (e.g. max-length 50 vs max-length 100)');
  parts.push('  - Contradictory behaviors for the same condition');
  parts.push('');
  parts.push('Do NOT auto-resolve contradictions. Report them.');
  parts.push('');

  parts.push('## OUTPUT');
  parts.push('Respond with JSON:');
  parts.push('{');
  parts.push('  "duplicateGroups": [');
  parts.push('    { "sourceTemporaryIds": ["cand-001", "cand-003"], "reason": "...", "confidence": 0.9 }');
  parts.push('  ],');
  parts.push('  "additionalConflicts": [');
  parts.push('    { "requirementTemporaryIds": ["cand-002", "cand-005"], "description": "...", "type": "contradiction", "provenance": [...], "confidence": 0.8 }');
  parts.push('  ]');
  parts.push('}');

  return parts.join('\n');
}
