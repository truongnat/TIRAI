// ---------------------------------------------------------------------------
// Step grounding tests — deterministic rules
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { groundStep } from '../src/grounding/step-grounding.js';
import { makeObservation, makeElement } from './fixtures/helpers.js';

describe('groundStep (deterministic)', () => {
  it('grounds a click on a uniquely matching accessible name', () => {
    const obs = makeObservation({
      elements: [
        makeElement({ id: 'el-001', role: 'textbox', accessibleName: 'Username' }),
        makeElement({ id: 'el-003', role: 'button', accessibleName: 'Login' }),
      ],
    });

    const result = groundStep({
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Click "Login" button',
      observation: obs,
    });

    expect(result.testCaseId).toBe('TC-001');
    expect(result.stepIndex).toBe(1);
    expect(result.action).toEqual({ type: 'click', elementId: 'el-003' });
    expect(result.confidence).toBe('high');
    expect(result.candidateActions).toHaveLength(1);
    expect(result.unresolvedReason).toBeUndefined();
  });

  it('grounds a fill with a literal value from stepInput', () => {
    const obs = makeObservation({
      elements: [makeElement({ id: 'el-001', role: 'textbox', accessibleName: 'Username' })],
    });

    const result = groundStep({
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Enter username',
      stepTarget: 'Username',
      stepInput: 'demo',
      observation: obs,
    });

    expect(result.action).toEqual({ type: 'fill', elementId: 'el-001', value: 'demo' });
  });

  it('preserves secret:// and testdata:// inputs via valueSource, never literal value', () => {
    const obs = makeObservation({
      elements: [makeElement({ id: 'el-002', role: 'textbox', accessibleName: 'Password', inputType: 'password' })],
    });

    for (const input of ['secret://login/password', 'testdata://DATA-PASSWORD']) {
      const result = groundStep({
        testCaseId: 'TC-001',
        stepIndex: 1,
        stepDescription: 'Enter password',
        stepTarget: 'Password',
        stepInput: input,
        observation: obs,
      });
      expect(result.action?.valueSource).toBe(input);
      expect(result.action?.value).toBeUndefined();
    }
  });

  it('is case-insensitive and trims labels when matching', () => {
    const obs = makeObservation({
      elements: [makeElement({ id: 'el-001', role: 'button', accessibleName: '  Log Out  ' })],
    });

    const result = groundStep({
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Click "log out"',
      observation: obs,
    });

    expect(result.action?.elementId).toBe('el-001');
    expect(result.confidence).toBe('high');
  });

  it('matches placeholders and visible text', () => {
    const obs = makeObservation({
      elements: [
        makeElement({ id: 'el-001', role: 'textbox', placeholder: 'Search users' }),
        makeElement({ id: 'el-002', role: 'link', visibleText: 'Open profile' }),
      ],
    });

    const fill = groundStep({
      testCaseId: 'TC-001', stepIndex: 1,
      stepDescription: 'Enter "Search users"',
      stepInput: 'ada',
      observation: obs,
    });
    expect(fill.action).toEqual({ type: 'fill', elementId: 'el-001', value: 'ada' });

    const click = groundStep({
      testCaseId: 'TC-001', stepIndex: 2,
      stepDescription: 'Click "Open profile"',
      observation: obs,
    });
    expect(click.action).toEqual({ type: 'click', elementId: 'el-002' });
  });

  it('returns ELEMENT_NOT_FOUND when nothing matches', () => {
    const obs = makeObservation({ elements: [] });

    const result = groundStep({
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Click "Nonexistent"',
      observation: obs,
    });

    expect(result.action).toBeUndefined();
    expect(result.confidence).toBe('low');
    expect(result.unresolvedReason).toBe('ELEMENT_NOT_FOUND');
    expect(result.candidateActions).toHaveLength(0);
  });

  it('returns AMBIGUOUS_TARGET with candidate actions when multiple elements match', () => {
    const obs = makeObservation({
      elements: [
        makeElement({ id: 'el-001', role: 'button', accessibleName: 'Submit' }),
        makeElement({ id: 'el-002', role: 'button', accessibleName: 'Submit' }),
      ],
    });

    const result = groundStep({
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Click "Submit"',
      observation: obs,
    });

    expect(result.action).toBeUndefined();
    expect(result.unresolvedReason).toBe('AMBIGUOUS_TARGET');
    expect(result.candidateActions).toHaveLength(2);
    expect(result.candidateActions.map((c) => c.action.elementId)).toEqual(['el-001', 'el-002']);
  });

  it('resolves locator-like stepTarget only against exposed element values', () => {
    const obs = makeObservation({
      elements: [
        makeElement({ id: 'el-001', role: 'button', accessibleName: 'Login', testId: 'login-button' }),
      ],
    });

    const byTestId = groundStep({
      testCaseId: 'TC-001', stepIndex: 1,
      stepDescription: 'Click login',
      stepTarget: 'data-testid: login-button',
      observation: obs,
    });
    expect(byTestId.action).toEqual({ type: 'click', elementId: 'el-001' });

    const byId = groundStep({
      testCaseId: 'TC-001', stepIndex: 1,
      stepDescription: 'Click login',
      stepTarget: '#el-001',
      observation: obs,
    });
    expect(byId.action).toEqual({ type: 'click', elementId: 'el-001' });

    const invented = groundStep({
      testCaseId: 'TC-001', stepIndex: 1,
      stepDescription: 'Click login',
      stepTarget: 'selector: button.primary',
      observation: obs,
    });
    expect(invented.action).toBeUndefined();
    expect(invented.unresolvedReason).toBe('ELEMENT_NOT_FOUND');
  });

  it('grounds navigate from stepTarget, stepInput, or quoted value', () => {
    const obs = makeObservation();
    for (const request of [
      { stepDescription: 'Navigate to dashboard', stepTarget: '/dashboard' },
      { stepDescription: 'Go to orders', stepInput: '/orders' },
      { stepDescription: 'Navigate to "/profile"' },
    ]) {
      const result = groundStep({ testCaseId: 'TC-001', stepIndex: 1, observation: obs, ...request });
      expect(result.action?.type).toBe('navigate');
      expect(result.action?.url).toMatch(/^\//);
    }
  });

  it('returns NAVIGATION_TARGET_MISSING when no URL is provided', () => {
    const result = groundStep({
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Navigate somewhere',
      observation: makeObservation(),
    });
    expect(result.action).toBeUndefined();
    expect(result.unresolvedReason).toBe('NAVIGATION_TARGET_MISSING');
  });

  it('grounds press with a key from stepInput', () => {
    const obs = makeObservation({
      elements: [makeElement({ id: 'el-001', role: 'textbox', accessibleName: 'Search' })],
    });
    const result = groundStep({
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Press Enter in "Search"',
      stepInput: 'Enter',
      observation: obs,
    });
    expect(result.action).toEqual({ type: 'press', elementId: 'el-001', key: 'Enter' });
  });

  it('grounds wait-for and observe deterministically', () => {
    const obs = makeObservation({
      elements: [makeElement({ id: 'el-001', role: 'button', accessibleName: 'Load more' })],
    });
    const wait = groundStep({
      testCaseId: 'TC-001', stepIndex: 1,
      stepDescription: 'Wait for "Load more"',
      observation: obs,
    });
    expect(wait.action).toEqual({ type: 'wait-for', elementId: 'el-001' });

    const observe = groundStep({
      testCaseId: 'TC-001', stepIndex: 2,
      stepDescription: 'Observe the page',
      observation: obs,
    });
    expect(observe.action).toEqual({ type: 'observe' });
  });

  it('returns STEP_UNPARSEABLE when no action verb is present', () => {
    const result = groundStep({
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Username field should be filled',
      observation: makeObservation(),
    });
    expect(result.action).toBeUndefined();
    expect(result.unresolvedReason).toBe('STEP_UNPARSEABLE');
  });

  it('includes previousFailure in reasoning for replan context', () => {
    const result = groundStep({
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Click "Missing"',
      previousFailure: 'Element detached',
      observation: makeObservation({ elements: [] }),
    });
    expect(result.reasoning).toContain('Element detached');
  });

  it('disambiguates fill between a label sibling and its textbox by role', () => {
    const obs = makeObservation({
      elements: [
        makeElement({ id: 'el-001', role: 'generic', accessibleName: 'Email' }),
        makeElement({ id: 'el-002', role: 'textbox', accessibleName: 'Email', placeholder: 'name@example.com' }),
      ],
    });
    const result = groundStep({
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Fill "Email" with tirai@example.com',
      stepTarget: 'Email',
      stepInput: 'tirai@example.com',
      observation: obs,
    });
    expect(result.action).toEqual({ type: 'fill', elementId: 'el-002', value: 'tirai@example.com' });
    expect(result.unresolvedReason).toBeUndefined();
  });

  it('stays fail-closed when two role-compatible matches remain ambiguous', () => {
    const obs = makeObservation({
      elements: [
        makeElement({ id: 'el-001', role: 'button', accessibleName: 'Delete' }),
        makeElement({ id: 'el-002', role: 'button', accessibleName: 'Delete' }),
      ],
    });
    const result = groundStep({
      testCaseId: 'TC-001',
      stepIndex: 1,
      stepDescription: 'Click "Delete"',
      observation: obs,
    });
    expect(result.unresolvedReason).toBe('AMBIGUOUS_TARGET');
  });
});
