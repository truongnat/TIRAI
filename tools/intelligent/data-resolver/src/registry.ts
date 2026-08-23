// ---------------------------------------------------------------------------
// Data Resolver – resolver registry
// ---------------------------------------------------------------------------
// Central registration point for data resolvers.  The resolution engine
// iterates registered resolvers and selects the best match for each data
// item.  Adding a new resolver requires only registration here — no
// modification of engine logic.

import type {
  DataResolver,
  ResolverType,
  TestDataItem,
  ResolutionContext,
  ResolverMatch,
} from './models.js';

const registry = new Map<ResolverType, DataResolver>();

/** Register a data resolver for a given type. */
export function registerResolver(resolver: DataResolver): void {
  registry.set(resolver.type, resolver);
}

/** Retrieve a registered resolver by type. */
export function getResolver(type: ResolverType): DataResolver | undefined {
  return registry.get(type);
}

/** List all registered resolver types. */
export function listResolvers(): ResolverType[] {
  return [...registry.keys()];
}

/**
 * Find the best resolver for a data item.
 *
 * Iterates all registered resolvers, collects match results, and returns
 * the resolver with the highest score.  Ties are broken by registration
 * order (first registered wins).
 */
export function findBestResolver(
  item: TestDataItem,
  context: ResolutionContext,
): { resolver: DataResolver; match: ResolverMatch } | undefined {
  let best: { resolver: DataResolver; match: ResolverMatch } | undefined;

  for (const resolver of registry.values()) {
    const match = resolver.canResolve(item, context);
    if (!match.supported) continue;

    if (!best || match.score > best.match.score) {
      best = { resolver, match };
    }
  }

  return best;
}

/** Remove all registered resolvers (useful for testing). */
export function clearRegistry(): void {
  registry.clear();
}
