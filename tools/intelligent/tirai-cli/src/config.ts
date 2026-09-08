import * as fs from 'node:fs';
import { CliError } from './errors.js';
import { type WorkspacePaths, CONFIG_VERSION } from './workspace.js';
import {
  type PlatformConfig,
  validatePlatformConfig,
  defaultPlatformConfig,
} from './platform-config.js';

export interface TiraiConfig {
  version: number;
  workspaceVersion: number;
  ai: {
    provider: 'fake' | 'groq' | 'deepseek';
    model?: string;
  };
  project: {
    root: string;
    name?: string;
    type?: 'web' | 'backend' | 'fullstack' | 'library' | 'mobile' | 'unknown';
    frontend?: string;
    backend?: string;
    database?: string;
    sourceCodePath?: string;
    defaultEnvironment?: string;
    defaultLanguage?: string;
  };
  platforms: PlatformConfig;
  // Legacy fields — kept for backward compatibility but deprecated
  source: {
    defaultPath?: string;
  };
  e2e: {
    baseUrl: string;
    startCommand?: string;
  };
  unit: {
    projectRoot: string;
    language?: string;
  };
}

export function defaultConfig(projectRoot: string): TiraiConfig {
  return {
    version: CONFIG_VERSION,
    workspaceVersion: 1,
    ai: {
      provider: 'fake',
      model: 'fake-model',
    },
    project: {
      root: projectRoot,
      name: undefined,
      type: 'unknown',
      defaultEnvironment: 'local',
      defaultLanguage: 'en',
    },
    platforms: defaultPlatformConfig(),
    source: {},
    e2e: {
      baseUrl: 'http://localhost:4173',
    },
    unit: {
      projectRoot,
      language: 'typescript',
    },
  };
}

export function loadConfig(paths: WorkspacePaths): TiraiConfig {
  if (!fs.existsSync(paths.configPath)) {
    throw new CliError('CONFIG_INVALID', `Config not found: ${paths.configPath}`, 'Run `tirai init` to create config.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(paths.configPath, 'utf8'));
  } catch (e) {
    throw new CliError('CONFIG_INVALID', `Config is not valid JSON: ${String(e)}`);
  }
  const config = raw as TiraiConfig;
  if (typeof config.version !== 'number') {
    throw new CliError('CONFIG_INVALID', 'Config missing version field');
  }
  if (config.version !== CONFIG_VERSION) {
    throw new CliError(
      'CONFIG_VERSION_UNSUPPORTED',
      `Unsupported config version ${config.version} (expected ${CONFIG_VERSION})`,
      'Re-run `tirai init` or migrate config.',
    );
  }
  if (!config.ai || typeof config.ai.provider !== 'string') {
    throw new CliError('CONFIG_INVALID', 'Config missing ai.provider (fake|groq|deepseek)');
  }
  if (config.ai.provider === 'groq' || config.ai.provider === 'deepseek') {
    const keyName = config.ai.provider === 'groq' ? 'GROQ_API_KEY' : 'DEEPSEEK_API_KEY';
    if (!process.env[keyName]) {
      throw new CliError(
        'CONFIG_INVALID',
        `Missing required credential: ${keyName} is not set`,
        `Set ${keyName} in your environment (do not put raw keys in config).`,
      );
    }
  }
  // Validate platforms if present
  if (config.platforms) {
    const result = validatePlatformConfig(config.platforms);
    if (!result.valid) {
      const msgs = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      throw new CliError('CONFIG_INVALID', `Platform config invalid: ${msgs}`);
    }
  }
  return config;
}

export function validateConfigForIngest(config: TiraiConfig): void {
  if (!config.ai.provider) throw new CliError('CONFIG_INVALID', 'Missing ai.provider');
}

export function validateConfigForGenerate(config: TiraiConfig): void {
  validateConfigForIngest(config);
  if (!config.e2e?.baseUrl) throw new CliError('CONFIG_INVALID', 'Missing e2e.baseUrl');
  if (!config.unit?.projectRoot) throw new CliError('CONFIG_INVALID', 'Missing unit.projectRoot');
}

export function validateConfigForRun(config: TiraiConfig): void {
  validateConfigForGenerate(config);
}

export function sanitizeConfigForWrite(config: TiraiConfig): TiraiConfig {
  const s = JSON.stringify(config);
  if (/sk-(?:proj-)?[A-Za-z0-9_-]{20,}/.test(s) || /AKIA[0-9A-Z]{16}/.test(s)) {
    throw new CliError('CONFIG_INVALID', 'Config appears to contain a raw secret. Use env vars.');
  }
  return config;
}
