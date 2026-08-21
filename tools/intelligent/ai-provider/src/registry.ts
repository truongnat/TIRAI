// ---------------------------------------------------------------------------
// AI Provider Registry / Factory
// ---------------------------------------------------------------------------
// Central registration point. Higher-level code creates providers via
// `createAIProvider({ provider: 'groq' })` instead of `new GroqProvider(...)`.

import type { AIProvider } from './provider.js';
import { AIProviderError, AIProviderErrorCode } from './errors.js';
import { GroqProvider } from './providers/groq/groq-provider.js';
import type { GroqProviderConfig } from './providers/groq/groq-config.js';

/** Factory function that creates an AIProvider instance. */
export type ProviderFactory = (config?: Record<string, unknown>) => AIProvider;

/** Known provider identifiers. */
export type KnownProvider = 'groq';

const registry = new Map<string, ProviderFactory>();

// Register built-in providers
registry.set('groq', (config) => new GroqProvider(config as Partial<GroqProviderConfig>));

/**
 * Create an AI provider by name.
 *
 * @example
 * ```ts
 * const provider = createAIProvider({ provider: 'groq' });
 * const response = await provider.generate({ messages: [...] });
 * ```
 */
export function createAIProvider(opts: {
  provider: KnownProvider | string;
  config?: Record<string, unknown>;
}): AIProvider {
  const factory = registry.get(opts.provider);
  if (!factory) {
    throw new AIProviderError({
      code: AIProviderErrorCode.CONFIG_ERROR,
      provider: opts.provider,
      message: `Unknown provider "${opts.provider}". Registered: ${[...registry.keys()].join(', ')}`,
    });
  }
  return factory(opts.config);
}

/** Register a custom provider factory. */
export function registerProvider(name: string, factory: ProviderFactory): void {
  registry.set(name, factory);
}

/** List all registered provider names. */
export function listProviders(): string[] {
  return [...registry.keys()];
}
