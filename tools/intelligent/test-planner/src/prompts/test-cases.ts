// ---------------------------------------------------------------------------
// Test Planner – test case extraction prompt
// ---------------------------------------------------------------------------

import type { RequirementIRInput, ScenarioCandidate } from '../models.js';

/**
 * Build the user prompt for test case candidate generation.
 */
export function buildTestCasePrompt(
  requirements: RequirementIRInput['requirements'],
  scenarios: ScenarioCandidate[],
): string {
  const reqMap = new Map(requirements.map((r) => [r.id, r]));

  const scenarioDescriptions = scenarios
    .map((s) => {
      const reqs = s.requirementIds
        .map((id) => {
          const r = reqMap.get(id);
          return r ? `${id}: ${r.statement}` : id;
        })
        .join('\n    ');

      const requirementContext = s.requirementIds
        .map((id) => {
          const r = reqMap.get(id);
          if (!r) return id;
          return `${id}: preconditions=[${r.preconditions.map((p) => p.description).join('; ')}]; constraints=[${r.constraints.map((c) => c.description).join('; ')}]; outcomes=[${r.outcomes.map((o) => `${o.description}${o.state ? ` (${o.state})` : ''}`).join('; ')}]; data=[${r.dataNeeds?.map((d) => d.description).join('; ') || ''}]`;
        })
        .join('\n    ');

      return `Scenario: ${s.temporaryId} – ${s.title}
  Category: ${s.category}
  Objective: ${s.objective}
  Requirements:
    ${reqs}
  Requirement context:
    ${requirementContext}
  Scenario preconditions: ${s.preconditions.map((p) => p.description).join('; ') || '(none)'}
  Scenario data needs: ${s.dataNeeds.map((d) => d.description).join('; ') || '(none)'}
  Expected behavior: ${s.expectedBehavior.join('; ')}`;
    })
    .join('\n\n');

  return `Based on the scenario candidates, generate test case candidates.

Each test case should:
- Verify one primary behavior (atomic)
- Have logical steps (not UI selectors)
- Use input strategies (valid/invalid/boundary) without concrete values
- Have expected results derived ONLY from requirement evidence
- Identify data needs without generating concrete data
- Describe automation readiness (what could be automated, what is manual)

Do NOT:
- Invent expected results not supported by requirements
- Generate CSS selectors or framework-specific commands
- Create concrete test data values (that belongs to Test Data Planner)
- Add error handling expectations when error behavior is unspecified

Scenario batch:
${scenarioDescriptions}

Return exactly one JSON object with this structure:
{
  "testCases": [
    {
      "temporaryId": "TC-0001",
      "scenarioTemporaryId": "SCEN-0001",
      "requirementIds": ["REQ-XXXX"],
      "title": "Test case title",
      "objective": "What to verify",
      "type": "ui",
      "priority": "medium",
      "preconditions": [{"description": "Precondition", "sourceRequirementIds": ["REQ-XXXX"]}],
      "inputs": [{"name": "inputName", "valueStrategy": "valid", "value": "", "description": "Input description"}],
      "dataNeeds": [{"description": "Data needed", "type": "other", "constraints": [], "relatedRequirementIds": []}],
      "steps": [{"order": 1, "action": "Action", "target": "target", "input": "input", "expectedIntermediateResult": ""}],
      "expectedResults": [{"description": "Order status is CANCELLED", "verificationType": "state", "target": "order", "verificationIntent": {"kind": "persisted-business-state", "subject": "order", "property": "status", "expectedValue": "CANCELLED", "authority": "PERSISTED_BUSINESS_STATE"}}],
      "cleanup": [],
      "automation": {"status": "ready", "suggestedExecutor": "ui", "reasons": []},
      "provenance": [{"requirementId": "REQ-XXXX"}],
      "confidence": 0.8
    }
  ],
  "additionalDataNeeds": []
}

Do not use alternative keys like test_cases, test_case_candidates, or cases.
Do not add markdown or explanations outside the JSON.`;
}
