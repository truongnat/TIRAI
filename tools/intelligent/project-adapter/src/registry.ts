// Adapter registry — register and resolve project adapters.
//
// Deterministic tie-breaking: highest score wins; on tie, first registered.

import type {
  ProjectAdapter,
  ProjectAdapterSource,
  ProjectAdapterMatch,
} from './models.js';
import { ProjectAdapterError } from './errors.js';

export class ProjectAdapterRegistry {
  private adapters: ProjectAdapter[] = [];

  register(adapter: ProjectAdapter): void {
    // Reject duplicate adapter IDs.
    if (this.adapters.some((a) => a.id === adapter.id && a.version === adapter.version)) {
      throw new ProjectAdapterError(
        'PROJECT_INTERNAL_ERROR',
        `Adapter already registered: ${adapter.id}@${adapter.version}`,
      );
    }
    this.adapters.push(adapter);
  }

  async resolve(source: ProjectAdapterSource): Promise<ProjectAdapter> {
    const matches: Array<{ adapter: ProjectAdapter; match: ProjectAdapterMatch }> = [];
    for (const adapter of this.adapters) {
      const match = await adapter.canLoad(source);
      if (match.supported) {
        matches.push({ adapter, match });
      }
    }
    if (matches.length === 0) {
      throw new ProjectAdapterError(
        'PROJECT_ADAPTER_NOT_FOUND',
        'No adapter can load the given project source',
      );
    }
    // Deterministic: highest score, then first registered.
    matches.sort((a, b) => b.match.score - a.match.score);
    return matches[0]!.adapter;
  }

  list(): ProjectAdapter[] {
    return [...this.adapters];
  }

  get size(): number {
    return this.adapters.length;
  }
}
