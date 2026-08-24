// ---------------------------------------------------------------------------
// Step grounding tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { groundStep } from '../src/grounding/step-grounding.js';
import { createFakeAI, createGroundingHandler, makeObservation, makeElement } from './fixtures/helpers.js';

describe('groundStep', () => {
  it('returns action from AI with correct structure', async () => {
    const obs = makeObservation({
      elements: [
        makeElement({ id: 'el-001', role: 'textbox', accessibleName: 'Username', placeholder: 'Username' }),
        makeElement({ id: 'el-003', role: 'button', accessibleName: 'Login' }),
      ],
    });

    const ai = createFakeAI(createGroundingHandler({ type: 'click', elementId: 'el-003' }));

    const result = await groundStep(ai, {
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Click the login button',
      observation: obs,
    });

    expect(result.testCaseId).toBe('TC-001');
    expect(result.stepIndex).toBe(1);
    expect(result.action).toBeDefined();
    expect(result.action!.type).toBe('click');
    expect(result.action!.elementId).toBe('el-003');
    expect(result.confidence).toBe('high');
    expect(result.candidateActions).toHaveLength(1);
  });

  it('returns fill action with value', async () => {
    const obs = makeObservation({
      elements: [
        makeElement({ id: 'el-001', role: 'textbox', accessibleName: 'Username', placeholder: 'Username' }),
      ],
    });

    const ai = createFakeAI(createGroundingHandler({ type: 'fill', elementId: 'el-001', value: 'demo' }));

    const result = await groundStep(ai, {
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Enter username',
      stepInput: 'demo',
      observation: obs,
    });

    expect(result.action!.type).toBe('fill');
    expect(result.action!.value).toBe('demo');
  });

  it('returns no action when element not found', async () => {
    const obs = makeObservation({ elements: [] });

    const ai = createFakeAI((_req) => ({
      action: undefined,
      confidence: 'low',
      reasoning: 'No matching element',
      unresolvedReason: 'AGENT_GROUNDING_FAILED',
    }));

    const result = await groundStep(ai, {
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Click nonexistent button',
      observation: obs,
    });

    expect(result.action).toBeUndefined();
    expect(result.confidence).toBe('low');
    expect(result.unresolvedReason).toBe('AGENT_GROUNDING_FAILED');
  });

  it('passes previous failure for replan context', async () => {
    const obs = makeObservation({
      elements: [makeElement({ id: 'el-001', role: 'button', accessibleName: 'Submit' })],
    });

    let receivedPreviousFailure: string | undefined;
    const ai = createFakeAI((req) => {
      const msgs = req.messages;
      const userMsg = msgs.find((m) => m.role === 'user');
      if (userMsg && userMsg.content.includes('Previous attempt failed')) {
        receivedPreviousFailure = 'extracted';
      }
      return {
        action: { type: 'click', elementId: 'el-001' },
        confidence: 'medium',
        reasoning: 'Retry after failure',
      };
    });

    await groundStep(ai, {
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Click submit',
      observation: obs,
      previousFailure: 'Element el-002 not found',
    });

    expect(receivedPreviousFailure).toBe('extracted');
  });

  it('returns navigate action', async () => {
    const obs = makeObservation();
    const ai = createFakeAI(createGroundingHandler({ type: 'navigate', url: '/dashboard' }));

    const result = await groundStep(ai, {
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Navigate to dashboard',
      observation: obs,
    });

    expect(result.action!.type).toBe('navigate');
    expect(result.action!.url).toBe('/dashboard');
  });
});
