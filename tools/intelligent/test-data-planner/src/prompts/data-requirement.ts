// ---------------------------------------------------------------------------
// Test Data Planner – data requirement extraction prompt
// ---------------------------------------------------------------------------

import type { TestCaseIRInput } from '../models.js';

/**
 * Build the user prompt for data requirement extraction.
 */
export function buildDataRequirementPrompt(
  testCases: TestCaseIRInput['testCases'],
  globalDataNeeds?: TestCaseIRInput['dataNeeds'],
): string {
  const lines: string[] = [
    '## Task: Extract Data Requirements from Test Cases',
    '',
    'For each test case below, identify all data items required to execute it.',
    'Consider: inputs, preconditions, expected results, data needs, steps.',
    '',
    'For each data item, determine:',
    '- type (input, database-record, account, state, external-response, file, configuration, token, identifier, reference-data, other)',
    '- lifecycle (existing, temporary, generated, shared, persistent, unknown)',
    '- strategy (reuse-existing, create-new, generate, derive, mock, stub, configure, select-existing, unknown)',
    '- constraints (only those supported by test case or requirement evidence)',
    '',
    'If a data requirement cannot be fully determined, add it to unresolvedCandidates.',
    '',
    '## Test Cases',
    '',
  ];

  for (const tc of testCases) {
    lines.push(`### ${tc.id}: ${tc.title}`);
    lines.push(`Objective: ${tc.objective}`);
    lines.push(`Type: ${tc.type}, Priority: ${tc.priority}`);
    lines.push(`Requirement IDs: ${tc.requirementIds.join(', ')}`);

    if (tc.preconditions.length > 0) {
      lines.push('Preconditions:');
      for (const p of tc.preconditions) {
        lines.push(`  - ${p.description}`);
      }
    }

    if (tc.inputs.length > 0) {
      lines.push('Inputs:');
      for (const i of tc.inputs) {
        lines.push(`  - ${i.name}: strategy=${i.valueStrategy}${i.description ? ` (${i.description})` : ''}`);
      }
    }

    if (tc.dataNeeds.length > 0) {
      lines.push('Data Needs:');
      for (const d of tc.dataNeeds) {
        lines.push(`  - [${d.id}] ${d.description} (type: ${d.type})`);
        if (d.constraints.length > 0) {
          lines.push(`    constraints: ${d.constraints.join(', ')}`);
        }
      }
    }

    if (tc.expectedResults.length > 0) {
      lines.push('Expected Results:');
      for (const e of tc.expectedResults) {
        lines.push(`  - ${e.description}`);
      }
    }

    if (tc.cleanup.length > 0) {
      lines.push('Cleanup:');
      for (const c of tc.cleanup) {
        lines.push(`  - ${c.description}`);
      }
    }

    lines.push('');
  }

  if (globalDataNeeds && globalDataNeeds.length > 0) {
    lines.push('## Global Data Needs (from Test Planner)');
    lines.push('');
    for (const d of globalDataNeeds) {
      lines.push(`- [${d.id}] ${d.description} (type: ${d.type})`);
      if (d.constraints.length > 0) {
        lines.push(`  constraints: ${d.constraints.join(', ')}`);
      }
    }
    lines.push('');
  }

  lines.push('## Output');
  lines.push('');
  lines.push('Respond with JSON matching the data requirement extraction schema.');
  lines.push('Use temporaryId format "TMP-DATA-0001" etc.');

  return lines.join('\n');
}
