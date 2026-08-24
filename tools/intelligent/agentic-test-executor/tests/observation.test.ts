// ---------------------------------------------------------------------------
// Observation tests — browser observer + element ID map
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { observeBrowser } from '../src/observation/browser-observer.js';
import { ElementIdMap } from '../src/observation/element-id-map.js';
import { createFakePage, makeObservation, makeElement, type FakePageState } from './fixtures/helpers.js';

describe('observeBrowser', () => {
  it('returns structured observation from page.evaluate()', async () => {
    const observation = makeObservation({
      url: 'http://127.0.0.1:3000/login',
      title: 'Login',
      headings: ['Login'],
      elements: [
        makeElement({ id: 'el-001', role: 'textbox', accessibleName: 'Username', placeholder: 'Username', inputType: 'text' }),
        makeElement({ id: 'el-002', role: 'button', accessibleName: 'Login', visibleText: 'Login' }),
      ],
    });

    const state: FakePageState = {
      url: 'http://127.0.0.1:3000/login',
      title: 'Login',
      observation,
      clickedElements: [],
      filledElements: [],
      gotoCalls: [],
    };
    const page = createFakePage(state);

    const result = await observeBrowser(page);

    expect(result.url).toBe('http://127.0.0.1:3000/login');
    expect(result.title).toBe('Login');
    expect(result.headings).toEqual(['Login']);
    expect(result.elements).toHaveLength(2);
    expect(result.elements[0].id).toBe('el-001');
    expect(result.elements[0].role).toBe('textbox');
    expect(result.elements[1].id).toBe('el-002');
  });

  it('marks truncated when elements hit budget', async () => {
    const manyElements = Array.from({ length: 50 }, (_, i) =>
      makeElement({ id: `el-${String(i + 1).padStart(3, '0')}`, role: 'button', accessibleName: `Btn ${i}` }),
    );
    const observation = makeObservation({ elements: manyElements });

    const state: FakePageState = {
      url: 'http://127.0.0.1:3000/',
      title: 'Test',
      observation,
      clickedElements: [],
      filledElements: [],
      gotoCalls: [],
    };
    const page = createFakePage(state);

    const result = await observeBrowser(page);
    expect(result.elements.length).toBe(50);
    expect(result.truncated).toBe(true);
  });

  it('assigns sequential IDs to observed elements', async () => {
    const observation = makeObservation({
      elements: [
        makeElement({ id: 'placeholder-1', role: 'button', accessibleName: 'A' }),
        makeElement({ id: 'placeholder-2', role: 'button', accessibleName: 'B' }),
        makeElement({ id: 'placeholder-3', role: 'button', accessibleName: 'C' }),
      ],
    });

    const state: FakePageState = {
      url: 'http://127.0.0.1:3000/',
      title: 'Test',
      observation,
      clickedElements: [],
      filledElements: [],
      gotoCalls: [],
    };
    const page = createFakePage(state);

    const result = await observeBrowser(page);
    expect(result.elements[0].id).toBe('el-001');
    expect(result.elements[1].id).toBe('el-002');
    expect(result.elements[2].id).toBe('el-003');
  });
});

describe('ElementIdMap', () => {
  it('maps element IDs to locators', () => {
    const obs = makeObservation({
      elements: [
        makeElement({ id: 'el-001', role: 'button', accessibleName: 'Login' }),
        makeElement({ id: 'el-002', role: 'textbox', placeholder: 'Username' }),
      ],
    });

    const map = ElementIdMap.fromObservation(obs);

    expect(map.size).toBe(2);
    expect(map.has('el-001')).toBe(true);
    expect(map.has('el-999')).toBe(false);

    const login = map.get('el-001');
    expect(login).toBeDefined();
    expect(login!.locator.strategy).toBe('role');

    const username = map.get('el-002');
    expect(username).toBeDefined();
    expect(username!.locator.strategy).toBe('placeholder');
  });

  it('uses role strategy when accessibleName + role present', () => {
    const obs = makeObservation({
      elements: [makeElement({ id: 'el-001', role: 'button', accessibleName: 'Submit' })],
    });
    const map = ElementIdMap.fromObservation(obs);
    const mapping = map.get('el-001')!;
    expect(mapping.locator.strategy).toBe('role');
    expect(mapping.locator.role).toBe('button');
    expect(mapping.locator.exact).toBe(true);
  });

  it('falls back to label strategy', () => {
    const obs = makeObservation({
      elements: [makeElement({ id: 'el-001', role: 'textbox', label: 'Email' })],
    });
    const map = ElementIdMap.fromObservation(obs);
    const mapping = map.get('el-001')!;
    expect(mapping.locator.strategy).toBe('label');
  });

  it('falls back to text strategy when visibleText + role present', () => {
    const obs = makeObservation({
      elements: [makeElement({ id: 'el-001', role: 'button', visibleText: 'Click me' })],
    });
    const map = ElementIdMap.fromObservation(obs);
    const mapping = map.get('el-001')!;
    expect(mapping.locator.strategy).toBe('text');
  });

  it('returns all mappings', () => {
    const obs = makeObservation({
      elements: [
        makeElement({ id: 'el-001', role: 'button', accessibleName: 'A' }),
        makeElement({ id: 'el-002', role: 'button', accessibleName: 'B' }),
      ],
    });
    const map = ElementIdMap.fromObservation(obs);
    expect(map.all()).toHaveLength(2);
  });
});
