// ---------------------------------------------------------------------------
// Diff engine – source-agnostic revision comparison
// ---------------------------------------------------------------------------
// Produces semantic-level change classification between two revision snapshots.

export type ChangeClassification =
  | 'added'
  | 'removed'
  | 'modified'
  | 'unchanged';

export interface DiffItem {
  /** Stable identity key (semanticId or content-hash based ID). */
  id: string;
  /** Human-readable label for display. */
  label: string;
  /** Classification of this item between the two revisions. */
  classification: ChangeClassification;
  /** The object from the base revision (null if added). */
  before: unknown | null;
  /** The object from the target revision (null if removed). */
  after: unknown | null;
}

export interface DiffResult {
  /** Overall change summary. */
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
  /** Per-category diff results. */
  categories: Record<string, DiffItem[]>;
  /** true if no changes detected. */
  identical: boolean;
}

/**
 * Compute a source-agnostic diff between two collections of objects.
 *
 * @param baseItems - Objects from the base (older) revision
 * @param targetItems - Objects from the target (newer) revision
 * @param options - Configuration for identity extraction and comparison
 * @returns Classified diff result
 */
export function computeDiff<T extends Record<string, unknown>>(
  baseItems: T[],
  targetItems: T[],
  options: {
    /** Extract the stable identity key from an object. */
    extractId: (item: T) => string;
    /** Extract a human-readable label. */
    extractLabel: (item: T) => string;
    /** Compute a content fingerprint for comparison (must be stable across runs). */
    computeFingerprint: (item: T) => string;
    /** Optional: category label for grouping. */
    category?: string;
  },
): DiffResult {
  const category = options.category ?? 'default';
  const categories: Record<string, DiffItem[]> = {};

  const baseMap = new Map<string, { item: T; fingerprint: string }>();
  for (const item of baseItems) {
    const id = options.extractId(item);
    baseMap.set(id, { item, fingerprint: options.computeFingerprint(item) });
  }

  const targetMap = new Map<string, { item: T; fingerprint: string }>();
  for (const item of targetItems) {
    const id = options.extractId(item);
    targetMap.set(id, { item, fingerprint: options.computeFingerprint(item) });
  }

  const items: DiffItem[] = [];
  const summary = { added: 0, removed: 0, modified: 0, unchanged: 0 };

  // Check items in base
  for (const [id, { item: baseItem, fingerprint: baseFingerprint }] of baseMap) {
    const target = targetMap.get(id);
    if (!target) {
      items.push({
        id,
        label: options.extractLabel(baseItem),
        classification: 'removed',
        before: baseItem,
        after: null,
      });
      summary.removed++;
    } else if (baseFingerprint !== target.fingerprint) {
      items.push({
        id,
        label: options.extractLabel(baseItem),
        classification: 'modified',
        before: baseItem,
        after: target.item,
      });
      summary.modified++;
    } else {
      items.push({
        id,
        label: options.extractLabel(baseItem),
        classification: 'unchanged',
        before: baseItem,
        after: target.item,
      });
      summary.unchanged++;
    }
  }

  // Check for additions (items in target but not in base)
  for (const [id, { item: targetItem }] of targetMap) {
    if (!baseMap.has(id)) {
      items.push({
        id,
        label: options.extractLabel(targetItem),
        classification: 'added',
        before: null,
        after: targetItem,
      });
      summary.added++;
    }
  }

  categories[category] = items;

  return {
    summary,
    categories,
    identical: summary.added === 0 && summary.removed === 0 && summary.modified === 0,
  };
}

/**
 * Merge multiple DiffResults into a single combined result.
 */
export function mergeDiffResults(...results: DiffResult[]): DiffResult {
  const combined: DiffResult = {
    summary: { added: 0, removed: 0, modified: 0, unchanged: 0 },
    categories: {},
    identical: true,
  };

  for (const result of results) {
    combined.summary.added += result.summary.added;
    combined.summary.removed += result.summary.removed;
    combined.summary.modified += result.summary.modified;
    combined.summary.unchanged += result.summary.unchanged;

    for (const [category, items] of Object.entries(result.categories)) {
      if (combined.categories[category]) {
        combined.categories[category].push(...items);
      } else {
        combined.categories[category] = [...items];
      }
    }

    if (!result.identical) combined.identical = false;
  }

  return combined;
}
