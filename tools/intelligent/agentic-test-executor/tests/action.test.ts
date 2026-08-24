// ---------------------------------------------------------------------------
// Action validation + execution tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { validateAction } from '../src/action/action-validator.js';
import { executeAction } from '../src/action/action-executor.js';
import { ElementIdMap } from '../src/observation/element-id-map.js';
import { defaultAgentPolicy, type BrowserObservation } from '../src/models.js';
import { createFakePage, makeObservation, makeElement, type FakePageState } from './fixtures/helpers.js';

describe('validateAction', () => {
  const obs: BrowserObservation = makeObservation({
    elements: [
      makeElement({ id: 'el-001', role: 'textbox', accessibleName: 'Username' }),
      makeElement({ id: 'el-002', role: 'button', accessibleName: 'Login' }),
    ],
  });
  const policy = defaultAgentPolicy();
  const metrics = { navigationActions: 0, totalActions: 0 };

  it('validates click action with existing element', () => {
    const result = validateAction({ type: 'click', elementId: 'el-002' }, obs, policy, metrics);
    expect(result.valid).toBe(true);
  });

  it('rejects click with missing elementId', () => {
    const result = validateAction({ type: 'click' }, obs, policy, metrics);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('elementId');
  });

  it('rejects click with stale element ID', () => {
    const result = validateAction({ type: 'click', elementId: 'el-999' }, obs, policy, metrics);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('validates navigate with relative URL', () => {
    const result = validateAction({ type: 'navigate', url: '/dashboard' }, obs, policy, metrics);
    expect(result.valid).toBe(true);
  });

  it('rejects navigate with external URL', () => {
    const result = validateAction({ type: 'navigate', url: 'https://evil.com' }, obs, policy, metrics);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('external');
  });

  it('rejects navigate without URL', () => {
    const result = validateAction({ type: 'navigate' }, obs, policy, metrics);
    expect(result.valid).toBe(false);
  });

  it('rejects navigate when navigation budget exhausted', () => {
    const exhausted = { navigationActions: 5, totalActions: 10 };
    const result = validateAction({ type: 'navigate', url: '/page' }, obs, policy, exhausted);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Navigation budget');
  });

  it('validates fill action with value', () => {
    const result = validateAction({ type: 'fill', elementId: 'el-001', value: 'demo' }, obs, policy, metrics);
    expect(result.valid).toBe(true);
  });

  it('rejects fill without value', () => {
    const result = validateAction({ type: 'fill', elementId: 'el-001' }, obs, policy, metrics);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('value');
  });

  it('validates press action with key', () => {
    const result = validateAction({ type: 'press', elementId: 'el-001', key: 'Enter' }, obs, policy, metrics);
    expect(result.valid).toBe(true);
  });

  it('rejects press without key', () => {
    const result = validateAction({ type: 'press', elementId: 'el-001' }, obs, policy, metrics);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('key');
  });

  it('validates observe action without element', () => {
    const result = validateAction({ type: 'observe' }, obs, policy, metrics);
    expect(result.valid).toBe(true);
  });
});

describe('executeAction', () => {
  function makePageWithState(obs: BrowserObservation) {
    const state: FakePageState = {
      url: obs.url,
      title: obs.title,
      observation: obs,
      clickedElements: [],
      filledElements: [],
      gotoCalls: [],
    };
    return { state, page: createFakePage(state) };
  }

  it('executes navigate action', async () => {
    const obs = makeObservation();
    const { state, page } = makePageWithState(obs);
    const idMap = ElementIdMap.fromObservation(obs);

    const result = await executeAction(page, { type: 'navigate', url: '/dashboard' }, idMap);
    expect(result.success).toBe(true);
    expect(state.gotoCalls).toContain('/dashboard');
  });

  it('executes click action', async () => {
    const obs = makeObservation({
      elements: [makeElement({ id: 'el-001', role: 'button', accessibleName: 'Login' })],
    });
    const { state, page } = makePageWithState(obs);
    const idMap = ElementIdMap.fromObservation(obs);

    const result = await executeAction(page, { type: 'click', elementId: 'el-001' }, idMap);
    expect(result.success).toBe(true);
    expect(state.clickedElements.length).toBe(1);
  });

  it('executes fill action', async () => {
    const obs = makeObservation({
      elements: [makeElement({ id: 'el-001', role: 'textbox', accessibleName: 'Username' })],
    });
    const { state, page } = makePageWithState(obs);
    const idMap = ElementIdMap.fromObservation(obs);

    const result = await executeAction(page, { type: 'fill', elementId: 'el-001', value: 'demo' }, idMap);
    expect(result.success).toBe(true);
    expect(state.filledElements[0].value).toBe('demo');
  });

  it('returns failure for unresolvable element', async () => {
    const obs = makeObservation({ elements: [] });
    const { page } = makePageWithState(obs);
    const idMap = ElementIdMap.fromObservation(obs);

    const result = await executeAction(page, { type: 'click', elementId: 'el-999' }, idMap);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot resolve');
  });

  it('executes observe action as no-op', async () => {
    const obs = makeObservation();
    const { page } = makePageWithState(obs);
    const idMap = ElementIdMap.fromObservation(obs);

    const result = await executeAction(page, { type: 'observe' }, idMap);
    expect(result.success).toBe(true);
  });

  it('returns failure on page error', async () => {
    const obs = makeObservation({
      elements: [makeElement({ id: 'el-001', role: 'button', accessibleName: 'Login' })],
    });
    const state: FakePageState = {
      url: obs.url,
      title: obs.title,
      observation: obs,
      clickedElements: [],
      filledElements: [],
      gotoCalls: [],
    };
    const page = createFakePage(state);
    page.click = async () => { throw new Error('Element detached'); };
    const idMap = ElementIdMap.fromObservation(obs);

    const result = await executeAction(page, { type: 'click', elementId: 'el-001' }, idMap);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Element detached');
  });
});
