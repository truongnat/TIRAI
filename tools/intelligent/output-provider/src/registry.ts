import { ProviderRegistry, OutputProvider, ProviderId } from './models.js';

export class InMemoryProviderRegistry implements ProviderRegistry {
  private providers = new Map<ProviderId, OutputProvider>();

  register(provider: OutputProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  resolve(providerId: ProviderId): OutputProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}. Delivery blocked.`);
    }
    return provider;
  }

  list(): OutputProvider[] {
    return Array.from(this.providers.values());
  }
}
