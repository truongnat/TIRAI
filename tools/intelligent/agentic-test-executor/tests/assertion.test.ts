// ---------------------------------------------------------------------------
// Assertion grounding tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { groundAssertion } from '../src/assertion/assertion-grounding.js';
import { createFakeAI, createAssertionHandler, makeObservation, makeElement } from './fixtures/helpers.js';

describe('groundAssertion', () => {
  it('returns text-visible assertion', async () => {
    const obs = makeObservation({
      headings: ['Welcome, demo!'],
      elements: [makeElement({ id: 'el-001', role: 'button', accessibleName: 'Logout' })],
    });

    const ai = createFakeAI(createAssertionHandler('text-visible', { expectedValue: 'Welcome, demo!' }));

    const result = await groundAssertion(ai, {
      testCaseId: 'TC-001',
      expectedResultIndex: 0,
      expectedDescription: 'Dashboard welcome message is shown',
      verificationType: 'ui',
      observation: obs,
    });

    expect(result.assertionType).toBe('text-visible');
    expect(result.expectedValue).toBe('Welcome, demo!');
    expect(result.confidence).toBe('high');
  });

  it('returns url-contains assertion', async () => {
    const obs = makeObservation({ url: 'http://127.0.0.1:3000/dashboard' });
    const ai = createFakeAI(createAssertionHandler('url-contains', { expectedValue: '/dashboard' }));

    const result = await groundAssertion(ai, {
      testCaseId: 'TC-001',
      expectedResultIndex: 0,
      expectedDescription: 'URL contains /dashboard',
      verificationType: 'ui',
      observation: obs,
    });

    expect(result.assertionType).toBe('url-contains');
    expect(result.expectedValue).toBe('/dashboard');
  });

  it('returns element-visible assertion with elementId', async () => {
    const obs = makeObservation({
      elements: [makeElement({ id: 'el-001', role: 'button', accessibleName: 'Logout' })],
    });
    const ai = createFakeAI(createAssertionHandler('element-visible', { elementId: 'el-001' }));

    const result = await groundAssertion(ai, {
      testCaseId: 'TC-001',
      expectedResultIndex: 0,
      expectedDescription: 'Logout button is visible',
      verificationType: 'ui',
      observation: obs,
    });

    expect(result.assertionType).toBe('element-visible');
    expect(result.elementId).toBe('el-001');
  });

  it('returns element-absent assertion', async () => {
    const obs = makeObservation({ elements: [] });
    const ai = createFakeAI(createAssertionHandler('element-absent', { elementId: 'el-004' }));

    const result = await groundAssertion(ai, {
      testCaseId: 'TC-001',
      expectedResultIndex: 0,
      expectedDescription: 'Error message is not shown',
      verificationType: 'ui',
      observation: obs,
    });

    expect(result.assertionType).toBe('element-absent');
  });

  it('returns unresolved when cannot determine assertion', async () => {
    const obs = makeObservation({ elements: [] });
    const ai = createFakeAI((_req) => ({
      assertionType: 'text-visible',
      confidence: 'low',
      reasoning: 'Cannot determine',
      unresolvedReason: 'AGENT_ASSERTION_UNRESOLVED',
    }));

    const result = await groundAssertion(ai, {
      testCaseId: 'TC-001',
      expectedResultIndex: 0,
      expectedDescription: 'Something unclear',
      verificationType: 'ui',
      observation: obs,
    });

    expect(result.unresolvedReason).toBe('AGENT_ASSERTION_UNRESOLVED');
  });

  it('returns title-contains assertion', async () => {
    const obs = makeObservation({ title: 'Dashboard - My App' });
    const ai = createFakeAI(createAssertionHandler('title-contains', { expectedValue: 'Dashboard' }));

    const result = await groundAssertion(ai, {
      testCaseId: 'TC-001',
      expectedResultIndex: 0,
      expectedDescription: 'Page title contains Dashboard',
      verificationType: 'ui',
      observation: obs,
    });

    expect(result.assertionType).toBe('title-contains');
    expect(result.expectedValue).toBe('Dashboard');
  });
});
