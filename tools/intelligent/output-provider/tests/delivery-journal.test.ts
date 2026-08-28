import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDeliveryJournal } from '../src/delivery-journal.js';
import { DeliveryJournalEntry } from '../src/models.js';

function makeEntry(overrides: Partial<DeliveryJournalEntry> = {}): Omit<DeliveryJournalEntry, 'id' | 'createdAt' | 'updatedAt' | 'attempt'> {
  return {
    outputId: 'out_test123',
    deliveryKey: 'dk_abc123',
    providerId: 'local-report',
    target: { type: 'local-file', path: 'report' },
    payloadFingerprint: 'fp_123',
    status: 'pending',
    ...overrides,
  };
}

describe('InMemoryDeliveryJournal', () => {
  let journal: InMemoryDeliveryJournal;

  beforeEach(() => {
    journal = new InMemoryDeliveryJournal();
  });

  describe('record', () => {
    it('creates a journal entry with generated id and timestamps', async () => {
      const entry = await journal.record(makeEntry());

      expect(entry.id).toMatch(/^dj_/);
      expect(entry.outputId).toBe('out_test123');
      expect(entry.deliveryKey).toBe('dk_abc123');
      expect(entry.status).toBe('pending');
      expect(entry.createdAt).toBeDefined();
      expect(entry.updatedAt).toBeDefined();
      expect(entry.attempt).toBe(1);
    });

    it('indexes by deliveryKey', async () => {
      await journal.record(makeEntry({ deliveryKey: 'dk_first' }));
      await journal.record(makeEntry({ deliveryKey: 'dk_second' }));

      const results = await journal.query({ deliveryKey: 'dk_first' });
      expect(results).toHaveLength(1);
      expect(results[0].deliveryKey).toBe('dk_first');
    });
  });

  describe('update', () => {
    it('updates entry and refreshes updatedAt', async () => {
      const entry = await journal.record(makeEntry());

      const updated = await journal.update(entry.id, {
        status: 'DELIVERED',
        payloadFingerprint: 'fp_456',
      });

      expect(updated.status).toBe('DELIVERED');
      expect(updated.payloadFingerprint).toBe('fp_456');
      expect(updated.updatedAt >= entry.updatedAt).toBe(true);
      expect(updated.id).toBe(entry.id);
      expect(updated.attempt).toBe(2);
    });

    it('updates deliveryKey index', async () => {
      const entry = await journal.record(makeEntry({ deliveryKey: 'dk_old' }));

      await journal.update(entry.id, { deliveryKey: 'dk_new' });

      const results = await journal.query({ deliveryKey: 'dk_new' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(entry.id);
    });

    it('throws for non-existent entry', async () => {
      await expect(journal.update('nonexistent', { status: 'DELIVERED' }))
        .rejects.toThrow('Delivery journal entry not found: nonexistent');
    });
  });

  describe('query', () => {
    it('filters by deliveryKey', async () => {
      await journal.record(makeEntry({ deliveryKey: 'dk_existing' }));

      const results = await journal.query({ deliveryKey: 'dk_existing' });
      expect(results).toHaveLength(1);
      expect(results[0].deliveryKey).toBe('dk_existing');
    });

    it('returns empty for non-existent deliveryKey', async () => {
      await journal.record(makeEntry({ deliveryKey: 'dk_existing' }));

      const results = await journal.query({ deliveryKey: 'dk_nonexistent' });
      expect(results).toHaveLength(0);
    });

    it('returns results sorted by createdAt descending', async () => {
      await journal.record(makeEntry());
      await journal.record(makeEntry());
      await journal.record(makeEntry());

      const results = await journal.query({});
      expect(results).toHaveLength(3);

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].createdAt >= results[i].createdAt).toBe(true);
      }
    });
  });

  describe('get', () => {
    it('retrieves entry by id', async () => {
      const entry = await journal.record(makeEntry());

      const retrieved = await journal.get(entry.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(entry.id);
    });

    it('returns null for non-existent id', async () => {
      const retrieved = await journal.get('nonexistent');
      expect(retrieved).toBeNull();
    });
  });

  describe('exists', () => {
    it('returns true for existing deliveryKey with non-blocked status', async () => {
      await journal.record(makeEntry({ deliveryKey: 'dk_active' }));

      expect(await journal.exists('dk_active')).toBe(true);
    });

    it('returns false for non-existent deliveryKey', async () => {
      expect(await journal.exists('dk_nonexistent')).toBe(false);
    });

    it('returns false for blocked entry', async () => {
      const entry = await journal.record(makeEntry({ deliveryKey: 'dk_blocked' }));
      await journal.update(entry.id, { status: 'BLOCKED' });

      expect(await journal.exists('dk_blocked')).toBe(false);
    });
  });

  describe('getByDeliveryKey', () => {
    it('returns entry by deliveryKey', async () => {
      const entry = await journal.record(makeEntry({ deliveryKey: 'dk_lookup' }));

      const found = await journal.getByDeliveryKey('dk_lookup');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(entry.id);
    });

    it('returns null for non-existent deliveryKey', async () => {
      const found = await journal.getByDeliveryKey('dk_nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('stats', () => {
    it('returns correct counts', async () => {
      await journal.record(makeEntry({ status: 'pending' }));
      await journal.record(makeEntry({ status: 'pending' }));
      await journal.record(makeEntry({ status: 'DELIVERED' }));
      await journal.record(makeEntry({ status: 'FAILED' }));
      await journal.record(makeEntry({ status: 'BLOCKED' }));

      const stats = await journal.stats();
      expect(stats.total).toBe(5);
      expect(stats.delivered).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.blocked).toBe(1);
      expect(stats.skipped).toBe(0);
      expect(stats.unchanged).toBe(0);
    });
  });
});
