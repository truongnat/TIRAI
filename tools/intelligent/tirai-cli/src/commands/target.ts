// ---------------------------------------------------------------------------
// TIRAI — Target configuration commands
// ---------------------------------------------------------------------------
// Per TIRAI v1 spec §10: `tirai target list/add/validate` command surface.

import * as fs from 'node:fs';
import { requireWorkspace } from '../workspace.js';
import { loadConfig, sanitizeConfigForWrite } from '../config.js';
import { updateState } from '../state.js';
import { CliError } from '../errors.js';
import {
  validatePlatformConfig,
  type PlatformConfig,
} from '../platform-config.js';

export interface TargetListOptions {
  cwd: string;
  json?: boolean;
}

export interface TargetAddOptions {
  cwd: string;
  platform: string;
  environment: string;
  url?: string;
  json?: boolean;
}

export interface TargetValidateOptions {
  cwd: string;
}

/**
 * List configured targets.
 */
export async function runTargetList(opts: TargetListOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const config = loadConfig(paths);

  const platforms: PlatformConfig = config.platforms || {
    web: { enabled: false, environments: {} },
    backend: { enabled: false, environments: {} },
    mobile: { enabled: false, targets: [] },
    database: { enabled: false, environments: {} },
  };

  const summary = {
    web: platforms.web?.enabled ? Object.keys(platforms.web.environments) : [],
    backend: platforms.backend?.enabled ? Object.keys(platforms.backend.environments) : [],
    mobile: platforms.mobile?.enabled ? platforms.mobile.targets.map((t: { platform: string }) => t.platform) : [],
    database: platforms.database?.enabled ? Object.keys(platforms.database.environments) : [],
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('Configured targets:');
    for (const [platform, envs] of Object.entries(summary)) {
      if (envs.length > 0) {
        console.log(`  ${platform}: ${envs.join(', ')}`);
      } else {
        console.log(`  ${platform}: (none)`);
      }
    }
  }
}

/**
 * Add a target platform environment.
 */
export async function runTargetAdd(opts: TargetAddOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const config = loadConfig(paths);
  const platform = opts.platform as 'web' | 'backend' | 'mobile' | 'database';

  if (!['web', 'backend', 'mobile', 'database'].includes(platform)) {
    throw new CliError(
      'INVALID_PLATFORM',
      `Unknown platform: ${opts.platform}. Must be web, backend, mobile, or database.`,
    );
  }

  if (!opts.url) {
    throw new CliError('INVALID_TARGET', 'Missing --url for target environment.');
  }

  const platforms = config.platforms || {
    web: { enabled: true, environments: {} },
    backend: { enabled: true, environments: {} },
    mobile: { enabled: true, targets: [] },
    database: { enabled: true, environments: {} },
  };

  // Set enabled and add environment/target
  if (platform === 'web' && platforms.web) {
    platforms.web.enabled = true;
    platforms.web.environments[opts.environment] = { baseUrl: opts.url! };
  } else if (platform === 'backend' && platforms.backend) {
    platforms.backend.enabled = true;
    platforms.backend.environments[opts.environment] = { baseUrl: opts.url! };
  } else if (platform === 'database' && platforms.database) {
    platforms.database.enabled = true;
    platforms.database.environments[opts.environment] = {
      type: 'postgres',
      connectionRef: 'env:TIRAI_DATABASE_URL',
      readOnly: true,
    };
  } else if (platform === 'mobile' && platforms.mobile) {
    platforms.mobile.enabled = true;
    platforms.mobile.targets.push({
      platform: opts.environment as 'android' | 'ios',
      packageName: opts.url!,
    });
  }

  config.platforms = platforms;
  sanitizeConfigForWrite(config);

  // Persist
  const configPath = paths.configPath;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  updateState(paths, (s) => ({
    ...s,
    platformConfig: {
      ...s.platformConfig,
      updatedAt: new Date().toISOString(),
    },
  }));

  if (opts.json) {
    console.log(JSON.stringify({ status: 'added', platform, environment: opts.environment }, null, 2));
  } else {
    console.log(`Added ${platform} target: ${opts.environment} (${opts.url})`);
  }
}

/**
 * Validate platform configuration.
 */
export async function runTargetValidate(opts: TargetValidateOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const config = loadConfig(paths);

  if (!config.platforms) {
    throw new CliError('NO_PLATFORMS', 'No platform configuration found.');
  }

  const result = validatePlatformConfig(config.platforms);
  if (result.valid) {
    console.log('Platform configuration is valid.');
  } else {
    console.error('Platform configuration errors:');
    for (const err of result.errors) {
      console.error(`  ${err.path}: ${err.message}`);
    }
    throw new CliError('CONFIG_INVALID', `${result.errors.length} platform config error(s).`);
  }
}
