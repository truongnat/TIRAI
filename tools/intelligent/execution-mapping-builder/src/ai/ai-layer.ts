// Execution Mapping Builder — AI integration layer.
//
// AI proposes mapping candidates for unresolved cases. AI must NOT produce
// trusted selectors. All AI output is validated against catalogs.

import type {
  AIProvider,
  TestCase,
  AIMappingCandidatesResponse,
  AICandidateMapping,
  ExecutorCandidate,
  StepMappingCandidate,
  AssertionMappingCandidate,
  MappingTrust,
} from '../models.js';
import { ExecutionMappingError } from '../errors.js';
import type { UICatalogResolver } from '../catalog/catalog.js';
import { isSupportedAction, isSupportedAssertion } from '../candidates/candidates.js';

// ---- JSON Schema for AI response -------------------------------------------

const MAPPING_CANDIDATES_SCHEMA = {
  type: 'object',
  properties: {
    mappingCandidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          testCaseId: { type: 'string' },
          executorType: { type: 'string', enum: ['ui', 'api', 'database', 'integration', 'manual', 'unknown'] },
          pageLogicalName: { type: 'string' },
          stepCandidates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                stepOrder: { type: 'number' },
                action: { type: 'string' },
                targetLogicalName: { type: 'string' },
                valueBinding: { type: 'string' },
                valueLiteral: { type: 'string' },
                secretRef: { type: 'string' },
                confidence: { type: 'number' },
              },
              required: ['stepOrder', 'action'],
            },
          },
          assertionCandidates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                expectedResultIndex: { type: 'number' },
                assertionType: { type: 'string' },
                targetLogicalName: { type: 'string' },
                expectedValue: { type: 'string' },
                confidence: { type: 'number' },
              },
              required: ['expectedResultIndex', 'assertionType'],
            },
          },
        },
        required: ['testCaseId', 'executorType', 'stepCandidates', 'assertionCandidates'],
      },
    },
    unresolvedCandidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          testCaseId: { type: 'string' },
          stage: { type: 'string' },
          description: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['testCaseId', 'stage', 'description', 'reason'],
      },
    },
  },
  required: ['mappingCandidates', 'unresolvedCandidates'],
};

// ---- Build evidence package for AI -----------------------------------------

export function buildEvidencePackage(
  testCase: TestCase,
  catalog: UICatalogResolver,
): string {
  const lines: string[] = [];
  lines.push(`Test Case: ${testCase.id}`);
  lines.push(`Title: ${testCase.title}`);
  lines.push(`Objective: ${testCase.objective}`);
  lines.push(`Type: ${testCase.type}`);
  lines.push('');
  lines.push('Steps:');
  for (const step of testCase.steps) {
    lines.push(`  ${step.order}. ${step.action}${step.target ? ` → ${step.target}` : ''}`);
  }
  lines.push('');
  lines.push('Expected Results:');
  for (const er of testCase.expectedResults) {
    lines.push(`  - ${er.description}`);
  }
  lines.push('');
  lines.push('Available UI elements:');
  for (const name of catalog.getAllElementNames()) {
    lines.push(`  - ${name}`);
  }
  return lines.join('\n');
}

// ---- Build system prompt ---------------------------------------------------

function buildSystemPrompt(): string {
  return `You are a design-time mapping assistant for a test execution pipeline.
Your task: propose mapping candidates for test cases that could not be mapped deterministically.

RULES:
1. Return ONLY valid JSON matching the provided schema.
2. Do NOT produce CSS selectors, XPath, or Playwright locators.
3. Reference elements ONLY by their logicalName from the available catalog.
4. Do NOT invent binding values or literal values.
5. Use only supported actions: navigate, click, fill, type, select, check, uncheck, press, wait, focus, blur, scroll, noop.
6. Use only supported assertions: visible, hidden, enabled, disabled, checked, unchecked, text-equals, text-contains, value-equals, url-equals, url-contains, element-count, attribute-equals, page-title, exists, not-exists.
7. If you cannot determine a mapping, add to unresolvedCandidates instead.

No markdown. No explanation. No alternate root keys.`;
}

// ---- Request AI candidates -------------------------------------------------

export async function requestAICandidates(
  provider: AIProvider,
  testCases: TestCase[],
  catalog: UICatalogResolver,
): Promise<{ candidates: ExecutorCandidate[]; tokensUsed: number; repairs: number }> {
  const evidence = testCases.map(tc => buildEvidencePackage(tc, catalog)).join('\n---\n');
  let repairs = 0;

  try {
    const response = await provider.generate<AIMappingCandidatesResponse>({
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: `Map these test cases:\n\n${evidence}` },
      ],
      responseSchema: MAPPING_CANDIDATES_SCHEMA,
      temperature: 0,
    });

    const data = response.data;
    const candidates = convertAICandidates(data.mappingCandidates ?? []);
    const tokensUsed = response.usage?.totalTokens ?? 0;

    return { candidates, tokensUsed, repairs };
  } catch (err) {
    // One repair attempt
    repairs++;
    try {
      const retryResponse = await provider.generate<AIMappingCandidatesResponse>({
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: `Map these test cases:\n\n${evidence}` },
          { role: 'assistant', content: '{ "mappingCandidates": [], "unresolvedCandidates": [] }' },
          { role: 'user', content: 'Please return valid JSON matching the schema exactly.' },
        ],
        responseSchema: MAPPING_CANDIDATES_SCHEMA,
        temperature: 0,
      });

      const data = retryResponse.data;
      const candidates = convertAICandidates(data.mappingCandidates ?? []);
      const tokensUsed = retryResponse.usage?.totalTokens ?? 0;

      return { candidates, tokensUsed, repairs };
    } catch {
      throw new ExecutionMappingError(
        'EMB_PROVIDER_FAILED',
        `AI provider failed after repair: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ---- Convert AI candidates to ExecutorCandidates ---------------------------

function convertAICandidates(aiMappings: AICandidateMapping[]): ExecutorCandidate[] {
  return aiMappings.map(ai => {
    const stepCandidates: StepMappingCandidate[] = (ai.stepCandidates ?? [])
      .filter(s => isSupportedAction(s.action))
      .map(s => ({
        stepOrder: s.stepOrder,
        action: s.action,
        targetLogicalName: s.targetLogicalName,
        valueBinding: s.valueBinding,
        valueLiteral: s.valueLiteral,
        secretRef: s.secretRef,
        trust: 'ai-inferred' as MappingTrust,
        evidence: ['ai-candidate'],
      }));

    const assertionCandidates: AssertionMappingCandidate[] = (ai.assertionCandidates ?? [])
      .filter(a => isSupportedAssertion(a.assertionType))
      .map(a => ({
        expectedResultIndex: a.expectedResultIndex,
        assertionType: a.assertionType,
        targetLogicalName: a.targetLogicalName,
        expectedValue: a.expectedValue,
        trust: 'ai-inferred' as MappingTrust,
        evidence: ['ai-candidate'],
      }));

    return {
      testCaseId: ai.testCaseId,
      executorType: ai.executorType,
      pageLogicalName: ai.pageLogicalName,
      stepCandidates,
      assertionCandidates,
      trust: 'ai-inferred',
      confidence: 0.5,
      evidence: ['ai-proposed'],
    };
  });
}
