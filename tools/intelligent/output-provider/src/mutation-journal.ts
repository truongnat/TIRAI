import { randomUUID } from 'node:crypto';
import {
  MutationJournal,
  MutationJournalEntry,
  MutationJournalStats,
  MutationOperation,
  MutationOutcome,
  ReconciliationState,
  DeliveryKeyId,
  ProviderId,
} from './mutation-models.js';

export class InMemoryMutationJournal implements MutationJournal {
  private entries = new Map<string, MutationJournalEntry>();
  private syncKeyIndex = new Map<DeliveryKeyId, string>();
  private idempotencyKeyIndex = new Map<string, string>();

  async record(
    entry: Omit<MutationJournalEntry, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<MutationJournalEntry> {
    const now = new Date().toISOString();
    const id = `mj_${randomUUID().slice(0, 12)}`;

    const fullEntry: MutationJournalEntry = {
      ...entry,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.entries.set(id, fullEntry);
    this.syncKeyIndex.set(entry.syncKey, id);

    if (entry.idempotencyKey) {
      this.idempotencyKeyIndex.set(entry.idempotencyKey, id);
    }

    return fullEntry;
  }

  async update(
    id: string,
    update: Partial<MutationJournalEntry>,
  ): Promise<MutationJournalEntry> {
    const existing = this.entries.get(id);
    if (!existing) {
      throw new Error(`Mutation journal entry not found: ${id}`);
    }

    const updated: MutationJournalEntry = {
      ...existing,
      ...update,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.entries.set(id, updated);

    if (update.syncKey && update.syncKey !== existing.syncKey) {
      this.syncKeyIndex.delete(existing.syncKey);
      this.syncKeyIndex.set(update.syncKey, id);
    }

    if (update.idempotencyKey && update.idempotencyKey !== existing.idempotencyKey) {
      if (existing.idempotencyKey) {
        this.idempotencyKeyIndex.delete(existing.idempotencyKey);
      }
      this.idempotencyKeyIndex.set(update.idempotencyKey, id);
    }

    return updated;
  }

  async getBySyncKey(syncKey: DeliveryKeyId): Promise<MutationJournalEntry | null> {
    const id = this.syncKeyIndex.get(syncKey);
    if (!id) return null;
    return this.entries.get(id) ?? null;
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<MutationJournalEntry | null> {
    const id = this.idempotencyKeyIndex.get(idempotencyKey);
    if (!id) return null;
    return this.entries.get(id) ?? null;
  }

  async query(filter: {
    syncKey?: DeliveryKeyId;
    providerId?: ProviderId;
    operation?: MutationOperation;
  }): Promise<MutationJournalEntry[]> {
    let results = Array.from(this.entries.values());

    if (filter.syncKey) {
      const id = this.syncKeyIndex.get(filter.syncKey);
      if (id) {
        results = results.filter((e) => e.id === id);
      } else {
        return [];
      }
    }

    if (filter.providerId) {
      results = results.filter((e) => e.providerId === filter.providerId);
    }

    if (filter.operation) {
      results = results.filter((e) => e.operation === filter.operation);
    }

    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async stats(): Promise<MutationJournalStats> {
    const entries = Array.from(this.entries.values());
    return {
      total: entries.length,
      createAttempts: entries.filter((e) => e.operation === 'CREATE').length,
      updateAttempts: entries.filter((e) => e.operation === 'UPDATE').length,
      noopDeliveries: entries.filter((e) => e.operation === 'NOOP').length,
      confirmedSuccess: entries.filter((e) => e.outcome === 'CONFIRMED_SUCCESS').length,
      confirmedFailure: entries.filter((e) => e.outcome === 'CONFIRMED_FAILURE').length,
      unknownOutcome: entries.filter((e) => e.outcome === 'UNKNOWN_MUTATION_OUTCOME').length,
      safeRetries: entries.reduce((sum, e) => sum + e.safeRetries, 0),
      unsafeRetries: entries.reduce((sum, e) => sum + e.unsafeRetries, 0),
    };
  }
}
