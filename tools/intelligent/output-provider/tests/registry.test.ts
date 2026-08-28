import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryProviderRegistry } from '../src/registry.js';
import { OutputProvider, CanonicalOutputPayload, OutputDeliveryContext, OutputDeliveryResult } from '../src/models.js';

function makeTestProvider(id: string): OutputProvider {
  return {
    id,
    displayName: `Test Provider ${id}`,
    deliver: async (payload, context) => ({
      success: true,
      status: 'DELIVERED',
      outputId: `out_${id}`,
      deliveryKey: context.target.path ?? 'default',
      payloadFingerprint: 'fp_test',
      providerId: id,
      target: context.target,
    }),
  };
}

describe('InMemoryProviderRegistry', () => {
  let registry: InMemoryProviderRegistry;

  beforeEach(() => {
    registry = new InMemoryProviderRegistry();
  });

  describe('register', () => {
    it('registers a provider', () => {
      const provider = makeTestProvider('test-1');
      registry.register(provider);

      const list = registry.list();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('test-1');
    });

    it('throws on duplicate provider', () => {
      const provider = makeTestProvider('test-1');
      registry.register(provider);

      expect(() => registry.register(provider)).toThrow('Provider already registered: test-1');
    });
  });

  describe('resolve', () => {
    it('resolves registered provider', () => {
      const provider = makeTestProvider('test-1');
      registry.register(provider);

      const resolved = registry.resolve('test-1');
      expect(resolved.id).toBe('test-1');
    });

    it('throws for unknown provider', () => {
      expect(() => registry.resolve('unknown')).toThrow('Provider not found: unknown');
    });
  });

  describe('list', () => {
    it('returns all registered providers', () => {
      registry.register(makeTestProvider('a'));
      registry.register(makeTestProvider('b'));
      registry.register(makeTestProvider('c'));

      const list = registry.list();
      expect(list).toHaveLength(3);
      expect(list.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
    });
  });
});
