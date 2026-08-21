// ---------------------------------------------------------------------------
// AI Provider – public API
// ---------------------------------------------------------------------------
// Re-exports the core interface, models, errors, utilities, and providers.

// Core interface + models
export type {
  AIProvider,
} from './provider.js';

export type {
  AIMessage,
  JSONSchema,
  AIGenerationRequest,
  AIGenerationResponse,
  AIUsage,
  AIProviderCapabilities,
} from './models.js';

// Errors
export { AIProviderError, AIProviderErrorCode } from './errors.js';
export type { AIProviderErrorCodeKey } from './errors.js';

// Registry / factory
export { createAIProvider, registerProvider, listProviders } from './registry.js';
export type { ProviderFactory, KnownProvider } from './registry.js';

// Fake provider (for testing)
export { FakeAIProvider } from './fake-provider.js';
export type { FakeProviderOptions } from './fake-provider.js';

// Groq provider
export { GroqProvider } from './providers/groq/groq-provider.js';
export type { GroqProviderConfig } from './providers/groq/groq-config.js';
export { resolveGroqConfig } from './providers/groq/groq-config.js';

// Utilities
export { withRetry, DEFAULT_RETRY_OPTIONS } from './utils/retry.js';
export type { RetryOptions } from './utils/retry.js';
export { parseAndValidate } from './utils/json.js';
