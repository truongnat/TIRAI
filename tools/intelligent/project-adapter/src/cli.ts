#!/usr/bin/env node
// Project Adapter CLI — loads project config and produces canonical profile.
//
// Usage:
//   project-adapter --project ./my-project --config ./tirai.project.json \
//     --environment local --output ./output/project-profile

import { resolve } from 'node:path';
import { ProjectAdapterRegistry } from './registry.js';
import { JsonProjectAdapter } from './adapters/json-project-adapter.js';
import { validateProfile } from './validator.js';
import { deriveReadiness, deriveQuality } from './readiness.js';
import { writeProfileOutput } from './persistence/writer.js';
import type { ProjectAdapterSource } from './models.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
project-adapter — load project config and produce canonical execution profile

Options:
  --project <path>       Project root directory (required)
  --config <path>        Config file path (default: tirai.project.json)
  --environment <name>   Environment name (default: local)
  --output <path>        Output directory
  --adapter <type>       Adapter type (default: json)
  --pretty               Pretty-print JSON output
  --validate-only        Load and validate but skip writing full profile
  --help, -h             Show this help
`);
    process.exit(0);
  }

  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const projectRoot = getArg('project');
  if (!projectRoot) {
    console.error('Error: --project is required');
    process.exit(1);
  }

  const configPath = getArg('config');
  const environment = getArg('environment') ?? 'local';
  const outputDir = getArg('output');
  const pretty = args.includes('--pretty');
  const validateOnly = args.includes('--validate-only');

  const source: ProjectAdapterSource = {
    projectRoot: resolve(projectRoot),
    configPath,
    environment,
  };

  // Registry with JSON adapter.
  const registry = new ProjectAdapterRegistry();
  registry.register(new JsonProjectAdapter());

  try {
    const adapter = await registry.resolve(source);
    const profile = await adapter.load(source, { environment });
    const validation = validateProfile(profile);
    const readiness = deriveReadiness(profile);
    const quality = deriveQuality(profile, validation.warnings.length, validation.errors.length);

    const report = {
      schemaVersion: '1.0' as const,
      projectId: profile.project.id,
      environmentId: profile.environment.id,
      safety: profile.environment.safety,
      fingerprint: profile.fingerprint,
      errors: validation.errors,
      warnings: validation.warnings,
      quality,
      capabilities: profile.capabilities,
      readiness,
    };

    if (!validation.valid) {
      console.error('Validation failed:');
      for (const err of validation.errors) {
        console.error(`  [${err.code}] ${err.message}`);
      }
      process.exit(1);
    }

    if (validateOnly) {
      console.log(JSON.stringify(report, null, pretty ? 2 : undefined));
      return;
    }

    if (outputDir) {
      await writeProfileOutput({
        outputDir: resolve(outputDir),
        profile,
        report,
        pretty,
      });
      console.log(`Profile written to ${resolve(outputDir)}`);
    } else {
      console.log(JSON.stringify(profile, null, pretty ? 2 : undefined));
    }
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

main();
