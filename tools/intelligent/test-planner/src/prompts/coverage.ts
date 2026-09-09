// ---------------------------------------------------------------------------
// Test Planner – coverage analysis prompt
// ---------------------------------------------------------------------------

import type { RequirementIRInput } from '../models.js';

/**
 * Build the user prompt for coverage analysis of a requirement batch.
 */
export function buildCoveragePrompt(requirements: RequirementIRInput['requirements']): string {
  const reqSummaries = requirements
    .map((r) => {
      const parts = [
        `ID: ${r.id}`,
        `Type: ${r.type}`,
        `Statement: ${r.statement}`,
        `Nature: ${r.sourceNature}`,
        `Testability: ${r.testability.status}`,
      ];
      if (r.actor) parts.push(`Actor: ${r.actor}`);
      if (r.trigger) parts.push(`Trigger: ${r.trigger}`);
      if (r.preconditions.length > 0) {
        parts.push(`Preconditions: ${r.preconditions.map((p) => p.description).join('; ')}`);
      }
      if (r.expectedBehaviors.length > 0) {
        parts.push(
          `Expected behaviors: ${r.expectedBehaviors.map((b) => b.description).join('; ')}`,
        );
      }
      if (r.constraints.length > 0) {
        parts.push(`Constraints: ${r.constraints.map((c) => c.description).join('; ')}`);
      }
      if (r.outcomes.length > 0) {
        parts.push(
          `Business outcomes: ${r.outcomes.map((o) => `${o.description}${o.state ? ` [state: ${o.state}]` : ''}`).join('; ')}`,
        );
      }
      if (r.dataNeeds && r.dataNeeds.length > 0) {
        parts.push(
          `Required data: ${r.dataNeeds.map((d) => `${d.description}${d.constraints?.length ? ` [${d.constraints.join(', ')}]` : ''}`).join('; ')}`,
        );
      }
      if (r.inputs.length > 0) {
        parts.push(
          `Inputs: ${r.inputs.map((i) => `${i.name}${i.required ? ' (required)' : ''}${i.constraints?.length ? ` [${i.constraints.join(', ')}]` : ''}`).join(', ')}`,
        );
      }
      return parts.join('\n  ');
    })
    .join('\n\n');

  return `Analyze the following requirements and determine what testing strategies are justified for each.

For each requirement, inspect this behavior-dimension matrix and select ONLY strategies supported by evidence. Record an unresolved candidate for a dimension that is relevant but underspecified:
- happy-path: expected successful behavior
- positive: The requirement describes expected behavior that should work
- negative: The requirement describes invalid/failure behavior that should be tested
- boundary: The requirement contains a measurable constraint with explicit limits
- validation: The requirement describes input validation
- state-transition: The requirement describes a state change
- error-handling: The requirement explicitly describes error/failure handling
- interface: The requirement describes an API or system interface
- data: The requirement describes data constraints or integrity
- security: The requirement describes authentication or authorization
- empty: empty/null/no-result behavior
- loading: pending/in-progress behavior
- retry: retry behavior
- rollback: compensation or rollback behavior

Do NOT assign strategies that are not justified by the requirement evidence.
If a requirement is not-testable, explain why and suggest unresolved if appropriate.

Requirements:
${reqSummaries}

Return exactly one JSON object with this structure:
{
  "coverageCandidates": [
    {
      "requirementId": "REQ-XXXX",
      "strategies": ["positive", "validation"],
      "reasons": ["Justification for each strategy"],
      "confidence": 0.9
    }
  ],
  "unresolvedCandidates": []
}

Do not use alternative keys like coverage_analysis, requirements, or coverage.
Do not add markdown or explanations outside the JSON.`;
}
