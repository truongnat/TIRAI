// ---------------------------------------------------------------------------
// Test Planner – scenario extraction prompt
// ---------------------------------------------------------------------------

import type { RequirementIRInput, CoverageCandidate } from '../models.js';

/**
 * Build the user prompt for scenario candidate generation.
 */
export function buildScenarioPrompt(
  requirements: RequirementIRInput['requirements'],
  coverage: CoverageCandidate[],
  coverageMode: 'comprehensive' | 'minimal-sufficient' = 'comprehensive',
): string {
  const reqMap = new Map(requirements.map((r) => [r.id, r]));

  const batchDescriptions = coverage
    .map((c) => {
      const req = reqMap.get(c.requirementId);
      if (!req) return null;
      return `Requirement: ${req.id} – ${req.title}
  Statement: ${req.statement}
  Preconditions: ${req.preconditions.map((p) => p.description).join('; ') || '(none)'}
  Constraints: ${req.constraints.map((c) => c.description).join('; ') || '(none)'}
  Expected behaviors: ${req.expectedBehaviors.map((b) => b.description).join('; ') || '(none)'}
  Business outcomes: ${req.outcomes.map((o) => `${o.description}${o.state ? ` [state: ${o.state}]` : ''}`).join('; ') || '(none)'}
  Required data: ${req.dataNeeds?.map((d) => d.description).join('; ') || '(none)'}
  Strategies: ${c.strategies.join(', ')}
  Reasons: ${c.reasons.join('; ')}`;
    })
    .filter(Boolean)
    .join('\n\n');

  const coveragePolicy = coverageMode === 'minimal-sufficient'
    ? `\nAcceptance coverage policy: use minimal sufficient coverage. The input contains atomic requirements. Generate one scenario when compatible obligations can be covered together; do not create separate scenarios for individual steps or outcomes, and do not add alternate, negative, boundary, or permutation scenarios unless the requirement explicitly requires them.\n`
    : '';

  return `Based on the coverage analysis, generate test scenario candidates.
${coveragePolicy}

Each scenario should:
- Have a clear objective tied to requirement obligations
- Use the appropriate category (happy-path, negative, validation, boundary, etc.)
- Include preconditions only when supported by requirements
- Identify data needs without generating concrete data
- State expected behaviors ONLY from requirement evidence
- Assign priority based on requirement evidence (default: medium)

Do NOT:
- Create scenarios for strategies not justified by evidence
- Invent expected behaviors not present in requirements
- Generate generic scenarios like "system should work correctly"

Coverage batch:
${batchDescriptions}

Return exactly one JSON object with this structure:
{
  "scenarios": [
    {
      "temporaryId": "SCEN-0001",
      "title": "Scenario title",
      "objective": "What to verify",
      "category": "happy-path",
      "requirementIds": ["REQ-XXXX"],
      "preconditions": [{"description": "Precondition", "sourceRequirementIds": ["REQ-XXXX"]}],
      "dataNeeds": [{"description": "Data needed", "type": "other", "constraints": [], "relatedRequirementIds": []}],
      "expectedBehavior": ["Expected behavior 1"],
      "priority": "medium",
      "provenance": [{"requirementId": "REQ-XXXX"}],
      "confidence": 0.8
    }
  ]
}

Do not use alternative keys like scenario_candidates or candidates.
Do not add markdown or explanations outside the JSON.`;
}
