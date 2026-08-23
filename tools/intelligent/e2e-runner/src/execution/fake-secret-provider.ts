// Fake secret provider (spec §69).
//
// Returns predefined values for known secret names. Does NOT read real
// secrets or persist them.

import type { EndToEndSecretProvider } from '../models.js';

export class FakeSecretProvider implements EndToEndSecretProvider {
  private secrets: Map<string, string>;

  constructor(secrets?: Record<string, string>) {
    this.secrets = new Map(Object.entries(secrets ?? {}));
  }

  async resolve(name: string): Promise<string | undefined> {
    return this.secrets.get(name);
  }

  async has(name: string): Promise<boolean> {
    return this.secrets.has(name);
  }
}
