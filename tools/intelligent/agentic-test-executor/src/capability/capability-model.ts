// ---------------------------------------------------------------------------
// Agentic Test Executor — capability model
// ---------------------------------------------------------------------------

import type { AgentCapabilities } from '../models.js';

export function validateCapabilities(
  required: Partial<AgentCapabilities>,
  available: AgentCapabilities,
): { supported: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const [key, status] of Object.entries(required)) {
    if (status === 'AVAILABLE' && available[key as keyof AgentCapabilities] !== 'AVAILABLE') {
      missing.push(key);
    }
  }
  return { supported: missing.length === 0, missing };
}

export function isCapabilityAvailable(
  capabilities: AgentCapabilities,
  capability: keyof AgentCapabilities,
): boolean {
  return capabilities[capability] === 'AVAILABLE';
}
