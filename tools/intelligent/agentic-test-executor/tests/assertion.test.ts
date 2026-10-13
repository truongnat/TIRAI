// ---------------------------------------------------------------------------
// Assertion grounding tests — deterministic rules
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { groundAssertion } from '../src/assertion/assertion-grounding.js';
import { makeObservation, makeElement } from './fixtures/helpers.js';

function request(expectedDescription: string, elements = makeObservation().elements) {
  return {
    testCaseId: 'TC-001',
    expectedResultIndex: 0,
    expectedDescription,
    verificationType: 'ui',
    observation: makeObservation({ elements }),
  };
}

describe('groundAssertion (deterministic)', () => {
  it('grounds text-visible from quoted expected text', () => {
    const result = groundAssertion(request('Error message "Invalid credentials" is displayed'));

    expect(result.assertionType).toBe('text-visible');
    expect(result.expectedValue).toBe('Invalid credentials');
    expect(result.confidence).toBe('high');
    expect(result.unresolvedReason).toBeUndefined();
  });

  it('grounds text-visible from unquoted "text X is displayed" phrasing', () => {
    const result = groundAssertion(request('The welcome message Welcome, demo! is displayed'));

    expect(result.assertionType).toBe('text-visible');
    expect(result.expectedValue).toBe('Welcome, demo!');
  });

  it('grounds url-contains and url-equals', () => {
    const contains = groundAssertion(request('The url contains "/dashboard"'));
    expect(contains.assertionType).toBe('url-contains');
    expect(contains.expectedValue).toBe('/dashboard');

    const equals = groundAssertion(request('The page URL equals http://127.0.0.1/dashboard'));
    expect(equals.assertionType).toBe('url-equals');
    expect(equals.expectedValue).toBe('http://127.0.0.1/dashboard');
  });

  it('grounds title-contains and title-equals', () => {
    const contains = groundAssertion(request('The page title contains "Dashboard"'));
    expect(contains.assertionType).toBe('title-contains');
    expect(contains.expectedValue).toBe('Dashboard');

    const equals = groundAssertion(request('The page title equals "Dashboard"'));
    expect(equals.assertionType).toBe('title-equals');
  });

  it('grounds element-visible with a unique element match', () => {
    const elements = [makeElement({ id: 'el-001', role: 'button', accessibleName: 'Logout' })];
    const result = groundAssertion(request('The "Logout" button is visible', elements));

    expect(result.assertionType).toBe('element-visible');
    expect(result.elementId).toBe('el-001');
  });

  it('grounds element-absent when no element matches', () => {
    const result = groundAssertion(request('The "Spinner" element is not visible'));

    expect(result.assertionType).toBe('element-absent');
    expect(result.elementId).toBeUndefined();
  });

  it('grounds value-equals with expected value and element', () => {
    const elements = [makeElement({ id: 'el-001', role: 'textbox', accessibleName: 'Username' })];
    const result = groundAssertion(request('The username input value equals "demo"', elements));
    expect(result.assertionType).toBe('value-equals');
    expect(result.expectedValue).toBe('demo');
    expect(result.elementId).toBe('el-001');
  });

  it('returns ASSERTION_UNPARSEABLE when nothing can be determined', () => {
    const result = groundAssertion(request('Everything should work correctly'));

    expect(result.confidence).toBe('low');
    expect(result.unresolvedReason).toBe('ASSERTION_UNPARSEABLE');
  });
});
