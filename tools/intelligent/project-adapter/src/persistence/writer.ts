// Persistence — writes profile output to disk.
//
// Recommended output layout:
// output/project-profile/
// ├── project-execution-profile.json
// ├── validation-report.json
// ├── manifest.json
// └── catalogs/

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  ProjectExecutionProfile,
  ProjectValidationReport,
} from '../models.js';

export interface PersistenceOptions {
  outputDir: string;
  profile: ProjectExecutionProfile;
  report: ProjectValidationReport;
  pretty?: boolean;
}

export async function writeProfileOutput(opts: PersistenceOptions): Promise<void> {
  const { outputDir, profile, report, pretty } = opts;
  const indent = pretty ? 2 : undefined;

  await mkdir(outputDir, { recursive: true });
  await mkdir(resolve(outputDir, 'catalogs'), { recursive: true });

  // Profile.
  await writeFile(
    resolve(outputDir, 'project-execution-profile.json'),
    JSON.stringify(profile, null, indent),
    'utf-8',
  );

  // Validation report.
  await writeFile(
    resolve(outputDir, 'validation-report.json'),
    JSON.stringify(report, null, indent),
    'utf-8',
  );

  // Catalogs.
  if (profile.ui) {
    await writeFile(
      resolve(outputDir, 'catalogs', 'ui-catalog.json'),
      JSON.stringify(profile.ui.catalog, null, indent),
      'utf-8',
    );
  }
  if (profile.api) {
    await writeFile(
      resolve(outputDir, 'catalogs', 'api-catalog.json'),
      JSON.stringify(
        { resources: profile.api.resources, operations: profile.api.operations },
        null,
        indent,
      ),
      'utf-8',
    );
  }
  if (profile.database) {
    await writeFile(
      resolve(outputDir, 'catalogs', 'database-catalog.json'),
      JSON.stringify(
        { resources: profile.database.resources, catalogs: profile.database.catalogs },
        null,
        indent,
      ),
      'utf-8',
    );
  }

  // Manifest.
  const manifest = {
    schemaVersion: '1.0',
    projectId: profile.project.id,
    environmentId: profile.environment.id,
    adapterId: profile.project.adapterId,
    adapterVersion: profile.project.adapterVersion,
    fingerprint: profile.fingerprint,
    generatedAt: new Date().toISOString(),
    files: {
      profile: 'project-execution-profile.json',
      validationReport: 'validation-report.json',
      catalogs: {
        ui: profile.ui ? 'catalogs/ui-catalog.json' : null,
        api: profile.api ? 'catalogs/api-catalog.json' : null,
        database: profile.database ? 'catalogs/database-catalog.json' : null,
      },
    },
  };
  await writeFile(
    resolve(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, indent),
    'utf-8',
  );
}
