// ---------------------------------------------------------------------------
// Agentic Test Executor — assertion grounding
// ---------------------------------------------------------------------------

import type { AIProvider } from 'ai-provider';
import type {
  AssertionGroundingRequest,
  AssertionGroundingResult,
  AgenticAssertionType,
  ConfidenceClass,
} from '../models.js';

const ASSERTION_SYSTEM_PROMPT = `You are a test execution agent. Your job is to determine how to verify an expected test result by observing the current browser state.

RULES:
1. Choose an assertion type from: text-visible, element-visible, element-absent, url-contains, url-equals, value-equals, title-contains, title-equals.
2. If the assertion requires checking a specific element, provide the element ID from the observation.
3. If the assertion is about the page URL or title, no element ID is needed.
4. Provide the expected value to compare against (if applicable).
5. If you cannot determine how to verify the expected result, set unresolvedReason.
6. Set confidence to "high" if the verification is clear, "medium" if reasonable, "low" if uncertain.`;

const ASSERTION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    assertionType: {
      type: 'string',
      enum: ['text-visible', 'element-visible', 'element-absent', 'url-contains', 'url-equals', 'value-equals', 'title-contains', 'title-equals'],
    },
    elementId: { type: 'string' },
    expectedValue: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string' },
    unresolvedReason: { type: 'string' },
  },
  required: ['assertionType', 'confidence', 'reasoning'],
  additionalProperties: false,
} as const;

interface AssertionAIResponse {
  assertionType: AgenticAssertionType;
  elementId?: string;
  expectedValue?: string;
  confidence: ConfidenceClass;
  reasoning: string;
  unresolvedReason?: string;
}

export async function groundAssertion(
  ai: AIProvider,
  request: AssertionGroundingRequest,
): Promise<AssertionGroundingResult> {
  const obsSummary = [
    `URL: ${request.observation.url}`,
    `Title: ${request.observation.title}`,
    request.observation.headings.length > 0
      ? `Headings: ${request.observation.headings.join(', ')}`
      : '',
    `Visible page text: ${request.observation.pageText.slice(0, 2000)}`,
    `Interactive elements (${request.observation.elements.length}):`,
    ...request.observation.elements.map((el) => {
      const details = [el.id, el.role];
      if (el.accessibleName) details.push(`name="${el.accessibleName}"`);
      if (el.visibleText) details.push(`text="${el.visibleText}"`);
      if (el.inputType) details.push(`type=${el.inputType}`);
      return `  ${details.join(' ')}`;
    }),
  ].filter(Boolean).join('\n');

  const userMessage = [
    `Expected result: ${request.expectedDescription}`,
    `Verification type: ${request.verificationType}`,
    '',
    'Current browser state:',
    obsSummary,
  ].join('\n');

  const response = await ai.generate<AssertionAIResponse>({
    messages: [
      { role: 'system', content: ASSERTION_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    responseSchema: ASSERTION_RESPONSE_SCHEMA,
    temperature: 0,
    maxOutputTokens: 512,
    providerOptions: { deepseek: { thinking: 'disabled' } },
  });

  const data = response.data;

  return {
    testCaseId: request.testCaseId,
    expectedResultIndex: request.expectedResultIndex,
    assertionType: data.assertionType,
    elementId: data.elementId,
    expectedValue: data.expectedValue,
    confidence: data.confidence,
    reasoning: data.reasoning,
    unresolvedReason: data.unresolvedReason,
  };
}
