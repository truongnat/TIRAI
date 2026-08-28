import { randomUUID } from 'node:crypto';
import {
  DeliveryJournalEntry,
  DeliveryJournalStats,
  DeliveryStatus,
  DeliveryKeyId,
  PayloadFingerprint,
  OutputTarget,
} from './models.js';

export interface DeliveryJournal {
  record(entry: Omit<DeliveryJournalEntry, 'id' | 'createdAt' | 'updatedAt' | 'attempt'>): Promise<DeliveryJournalEntry>;
  update(id: string, update: Partial<DeliveryJournalEntry>): Promise<DeliveryJournalEntry>;
  query(filter: { runId?: string; deliveryKey?: DeliveryKeyId; outputId?: string }): Promise<DeliveryJournalEntry[]>;
  get(id: string): Promise<DeliveryJournalEntry | null>;
  exists(deliveryKey: DeliveryKeyId): Promise<boolean>;
  getByDeliveryKey(deliveryKey: DeliveryKeyId): Promise<DeliveryJournalEntry | null>;
  stats(): Promise<DeliveryJournalStats>;
}

export class InMemoryDeliveryJournal implements DeliveryJournal {
  private entries = new Map<string, DeliveryJournalEntry>();
  private deliveryKeyIndex = new Map<DeliveryKeyId, string>();

  async record(
    entry: Omit<DeliveryJournalEntry, 'id' | 'createdAt' | 'updatedAt' | 'attempt'>,
  ): Promise<DeliveryJournalEntry> {
    const now = new Date().toISOString();
    const id = `dj_${randomUUID().slice(0, 12)}`;

    const fullEntry: DeliveryJournalEntry = {
      ...entry,
      id,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.entries.set(id, fullEntry);
    this.deliveryKeyIndex.set(entry.deliveryKey, id);

    return fullEntry;
  }

  async update(
    id: string,
    update: Partial<DeliveryJournalEntry>,
  ): Promise<DeliveryJournalEntry> {
    const existing = this.entries.get(id);
    if (!existing) {
      throw new Error(`Delivery journal entry not found: ${id}`);
    }

    const updated: DeliveryJournalEntry = {
      ...existing,
      ...update,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      attempt: (existing.attempt ?? 0) + 1,
    };

    this.entries.set(id, updated);

    if (update.deliveryKey && update.deliveryKey !== existing.deliveryKey) {
      this.deliveryKeyIndex.delete(existing.deliveryKey);
      this.deliveryKeyIndex.set(update.deliveryKey, id);
    }

    return updated;
  }

  async query(filter: {
    runId?: string;
    deliveryKey?: DeliveryKeyId;
    outputId?: string;
  }): Promise<DeliveryJournalEntry[]> {
    let results = Array.from(this.entries.values());

    if (filter.runId) {
      results = results.filter((e) => e.deliveryKey.includes(filter.runId!));
    }

    if (filter.deliveryKey) {
      const id = this.deliveryKeyIndex.get(filter.deliveryKey);
      if (id) {
        results = results.filter((e) => e.id === id);
      } else {
        return [];
      }
    }

    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<DeliveryJournalEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async exists(deliveryKey: DeliveryKeyId): Promise<boolean> {
    const id = this.deliveryKeyIndex.get(deliveryKey);
    if (!id) return false;

    const entry = this.entries.get(id);
    return entry?.status !== 'BLOCKED';
  }

  async getByDeliveryKey(deliveryKey: DeliveryKeyId): Promise<DeliveryJournalEntry | null> {
    const id = this.deliveryKeyIndex.get(deliveryKey);
    if (!id) return null;
    return this.entries.get(id) ?? null;
  }

  async stats(): Promise<DeliveryJournalStats> {
    const entries = Array.from(this.entries.values());
    return {
      total: entries.length,
      delivered: entries.filter((e) => e.status === 'DELIVERED').length,
      skipped: entries.filter((e) => e.status === 'SKIPPED').length,
      failed: entries.filter((e) => e.status === 'FAILED').length,
      blocked: entries.filter((e) => e.status === 'BLOCKED').length,
      unchanged: entries.filter((e) => e.status === 'UNCHANGED').length,
    };
  }
}
