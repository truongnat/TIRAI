// ---------------------------------------------------------------------------
// Test Data Planner – dependency analysis prompt
// ---------------------------------------------------------------------------

import type { DataRequirementCandidate } from '../models.js';

/**
 * Build the user prompt for dependency and reuse analysis.
 */
export function buildDependencyPrompt(
  dataCandidates: DataRequirementCandidate[],
): string {
  const lines: string[] = [
    '## Task: Analyze Data Dependencies and Reuse Opportunities',
    '',
    'Given the following data requirement candidates, identify:',
    '1. Dependencies between data items (which items must exist before others)',
    '2. Reuse opportunities (which items can be shared across test cases)',
    '',
    'Dependency types:',
    '- requires: target needs source to exist',
    '- references: target references a value from source',
    '- derived-from: target is derived from source',
    '- created-after: target must be created after source',
    '- must-exist-before: source must exist before target can be created',
    '- cleanup-after: source cleanup must happen after target cleanup',
    '',
    'Reuse policies:',
    '- safe: Data can be freely shared (read-only, reference data)',
    '- isolated-copy: Each test gets its own copy',
    '- read-only: Data is read-only across tests',
    '',
    'Do NOT suggest reuse when:',
    '- A test mutates the data',
    '- Unique constraints differ between tests',
    '- Tests depend on isolated state',
    '- Cleanup of one would affect another',
    '',
    '## Data Candidates',
    '',
  ];

  for (const c of dataCandidates) {
    lines.push(`### ${c.temporaryId}: ${c.name}`);
    lines.push(`Test case: ${c.testCaseId}`);
    lines.push(`Type: ${c.type}, Lifecycle: ${c.lifecycle}, Strategy: ${c.strategy}`);
    lines.push(`Description: ${c.description}`);

    if (c.constraints.length > 0) {
      lines.push('Constraints:');
      for (const con of c.constraints) {
        lines.push(`  - [${con.type}] ${con.description}`);
      }
    }

    if (c.relatedRequirementIds.length > 0) {
      lines.push(`Related requirements: ${c.relatedRequirementIds.join(', ')}`);
    }

    lines.push('');
  }

  lines.push('## Output');
  lines.push('');
  lines.push('Respond with JSON matching the dependency analysis schema.');

  return lines.join('\n');
}
