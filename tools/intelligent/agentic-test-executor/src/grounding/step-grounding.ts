// ---------------------------------------------------------------------------
// Agentic Test Executor — step grounding
// ---------------------------------------------------------------------------

import type { AIProvider } from 'ai-provider';
import type {
  StepGroundingRequest,
  StepGroundingResult,
  BrowserObservation,
  AgenticAction,
  CandidateAction,
  ConfidenceClass,
} from '../models.js';

const GROUNDING_SYSTEM_PROMPT = `You are a test execution agent. Your job is to ground a test step to a specific browser action.

RULES:
1. You MUST select an element by its observation ID (e.g., "el-001"). NEVER invent CSS selectors, XPath, or other locators.
2. Choose the action type from: navigate, click, fill, select, check, uncheck, press, wait-for, observe.
3. For "fill" actions, use a non-sensitive literal only for public test data. For secret-backed input, set valueSource to the exact secret:// reference and do not put the secret in value.
4. For "navigate" actions, use a relative URL path.
5. If no element matches the step intent, set action to undefined and provide unresolvedReason.
6. If multiple elements could match, pick the best one and explain why in reasoning.
7. Set confidence to "high" if the match is clear, "medium" if reasonable, "low" if uncertain.`;

const GROUNDING_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['navigate', 'click', 'fill', 'select', 'check', 'uncheck', 'press', 'wait-for', 'observe'] },
        elementId: { type: 'string' },
        value: { type: 'string' },
        valueSource: { type: 'string', pattern: '^(secret|testdata)://' },
        url: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['type'],
      additionalProperties: false,
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string' },
    unresolvedReason: { type: 'string' },
  },
  required: ['confidence', 'reasoning'],
  additionalProperties: false,
} as const;

interface GroundingAIResponse {
  action?: AgenticAction;
  confidence: ConfidenceClass;
  reasoning: string;
  unresolvedReason?: string;
}

export async function groundStep(
  ai: AIProvider,
  request: StepGroundingRequest,
): Promise<StepGroundingResult> {
  const observationSummary = summarizeObservation(request.observation);

  const userMessage = [
    `Test step: ${request.stepDescription}`,
    request.stepTarget ? `Target: ${request.stepTarget}` : '',
    request.stepInput ? `Input: ${request.stepInput}` : '',
    request.previousFailure ? `Previous attempt failed: ${request.previousFailure}` : '',
    '',
    'Current browser state:',
    observationSummary,
  ].filter(Boolean).join('\n');

  const response = await ai.generate<GroundingAIResponse>({
    messages: [
      { role: 'system', content: GROUNDING_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    responseSchema: GROUNDING_RESPONSE_SCHEMA,
    temperature: 0,
    maxOutputTokens: 1024,
    providerOptions: { deepseek: { thinking: 'disabled' } },
  });

  const data = response.data;

  const candidateActions: CandidateAction[] = [];
  if (data.action) {
    candidateActions.push({ action: data.action, reason: data.reasoning });
  }

  return {
    testCaseId: request.testCaseId,
    stepIndex: request.stepIndex,
    stepIntent: request.stepDescription,
    action: data.action,
    candidateActions,
    confidence: data.confidence,
    reasoning: data.reasoning,
    unresolvedReason: data.unresolvedReason,
  };
}

function summarizeObservation(obs: BrowserObservation): string {
  const lines: string[] = [];
  lines.push(`URL: ${obs.url}`);
  lines.push(`Title: ${obs.title}`);
  if (obs.headings.length > 0) {
    lines.push(`Headings: ${obs.headings.join(', ')}`);
  }
  lines.push(`Interactive elements (${obs.elements.length}${obs.truncated ? ', truncated' : ''}):`);
  for (const el of obs.elements) {
    const parts = [el.id, el.role];
    if (el.accessibleName) parts.push(`name="${el.accessibleName}"`);
    if (el.label) parts.push(`label="${el.label}"`);
    if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
    if (el.inputType) parts.push(`type=${el.inputType}`);
    if (!el.enabled) parts.push('DISABLED');
    if (el.checked) parts.push('CHECKED');
    lines.push(`  ${parts.join(' ')}`);
  }
  return lines.join('\n');
}
