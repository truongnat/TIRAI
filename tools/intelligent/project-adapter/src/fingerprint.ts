// Profile fingerprint — SHA-256 deterministic hash of canonical profile data.
//
// Same config + catalogs + environment → same fingerprint.
// Used by E2E Runner to detect stale profiles.

import { createHash } from 'node:crypto';
import type { ProjectExecutionProfile } from './models.js';

export function computeProfileFingerprint(
  adapterVersion: string,
  configContent: string,
  catalogContents: string[],
  environmentId: string,
): string {
  const hash = createHash('sha256');
  // Deterministic ordering: adapter version, config, sorted catalogs, env.
  hash.update(`adapter:${adapterVersion}\n`);
  hash.update(`config:${configContent}\n`);
  const sorted = [...catalogContents].sort();
  for (const [i, c] of sorted.entries()) {
    hash.update(`catalog[${i}]:${c}\n`);
  }
  hash.update(`env:${environmentId}\n`);
  return hash.digest('hex');
}

export function computeFingerprintFromProfile(profile: ProjectExecutionProfile): string {
  // Re-derive from the profile's own identity fields for verification.
  const hash = createHash('sha256');
  hash.update(`project:${profile.project.id}\n`);
  hash.update(`adapter:${profile.project.adapterVersion}\n`);
  hash.update(`env:${profile.environment.id}\n`);
  hash.update(`ui:${profile.ui ? 'yes' : 'no'}\n`);
  hash.update(`api:${profile.api ? 'yes' : 'no'}\n`);
  hash.update(`db:${profile.database ? 'yes' : 'no'}\n`);
  hash.update(`bindings:${profile.bindings.definitions.length}\n`);
  hash.update(`secrets:${profile.secrets.references.length}\n`);
  hash.update(`commands:${profile.commands.commands.length}\n`);
  return hash.digest('hex');
}
