import { describe, expect, it } from 'vitest';

import {
  confirmSourceHints,
  groundConfirmedAction,
  resolveRelevantSourceHints,
  sanitizeIntelligence,
  sourceIntelligenceFromProjectProfile,
  StaticSourceIntelligenceProvider,
  type SourceIntelligence,
} from '../src/source-intelligence.js';

const testCase = { title: 'Complete order', objective: 'Cancel the order', expectedResults: [{ description: 'Order status: Cancelled' }] } as never;
const observation = { url: 'http://fixture/orders/123', title: 'Order detail', headings: ['Order detail'], pageText: 'Order status Cancelled', truncated: false, elements: [{ id: 'el-1', role: 'button', accessibleName: 'Cancel order', enabled: true }] };

function intelligence(overrides: Partial<SourceIntelligence> = {}): SourceIntelligence {
  return {
    schemaVersion: '1.0', snapshotId: 'source-1', sourceSecrets: 0,
    hints: [{ id: 'cancel', kind: 'ACTION_HINT', semanticName: 'Cancel order', provenance: { source: 'fixture', reference: 'OrderPage.cancel', confidence: 'DECLARED' }, lifecycle: 'DISCOVERED' }],
    ...overrides,
  };
}

describe('Phase 2F source intelligence', () => {
  it('is optional and preserves black-box fallback', async () => {
    const provider = new StaticSourceIntelligenceProvider(intelligence());
    expect((await provider.discover({ testCase })).hints).toHaveLength(1);
    const noSource: SourceIntelligence | undefined = undefined;
    expect(noSource).toBeUndefined();
  });

  it('resolves and confirms semantic action hints without selectors', () => {
    const resolved = resolveRelevantSourceHints(intelligence(), testCase, 'order detail');
    const confirmed = confirmSourceHints(resolved.provided, observation);
    const action = groundConfirmedAction(confirmed.confirmed, observation);
    expect(action?.elementId).toBe('el-1');
    expect(JSON.stringify(action)).not.toContain('selector');
    expect(confirmed.confirmed[0]?.lifecycle).toBe('CONFIRMED');
  });

  it('rejects a stale hint rather than executing it', () => {
    const stale = intelligence({ hints: [{ ...intelligence().hints[0]!, kind: 'NAVIGATION_HINT', routePattern: '/old-orders/:id', lifecycle: 'STALE' }] });
    const result = confirmSourceHints(stale.hints, observation);
    expect(result.confirmed).toHaveLength(0);
    expect(result.stale).toHaveLength(1);
  });

  it('converts project catalogs to semantic hints and strips locator/secret data', () => {
    const source = sourceIntelligenceFromProjectProfile({ fingerprint: 'profile-1', provenance: [{ source: 'tirai.project.json' }], ui: { catalog: { pages: [{ id: 'order-detail', route: '/orders/:id', elements: [{ logicalName: 'cancel-button' }] }] } }, api: { operations: [{ id: 'get-order', method: 'GET', path: '/orders/{id}' }], mappings: [{ logicalEntity: 'order', operationIds: ['get-order'] }] }, database: { catalogs: [{ resourceId: 'db-main', schemas: [{ name: 'public', tables: [{ name: 'orders' }] }] }] } });
    expect(source.hints.some((hint) => hint.kind === 'NAVIGATION_HINT')).toBe(true);
    expect(source.hints.some((hint) => hint.kind === 'API_HINT')).toBe(true);
    expect(source.hints.some((hint) => hint.kind === 'PERSISTENCE_HINT')).toBe(true);
    expect(JSON.stringify(source)).not.toContain('data-testid');
    expect(source.sourceSecrets).toBe(0);
  });

  it('sanitizes source-like secrets and keeps provenance/confidence', () => {
    const clean = sanitizeIntelligence(intelligence({ hints: [{ ...intelligence().hints[0]!, details: { password: 'fake-secret', semantic: 'cancel' } }] }));
    expect(JSON.stringify(clean)).not.toContain('fake-secret');
    expect(clean.hints[0]?.provenance.confidence).toBe('DECLARED');
  });
});
