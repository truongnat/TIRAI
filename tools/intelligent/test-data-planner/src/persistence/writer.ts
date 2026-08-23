// ---------------------------------------------------------------------------
// Test Data Planner – output writer
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  TestDataPlanIR,
  TestDataPlannerManifest,
  DataRequirementExtractionResult,
  DependencyAnalysisResult,
} from '../models.js';

/**
 * Write the complete test data planner output to disk.
 *
 * Structure:
 *   outputDir/
 *   ├── test-data-plan-ir.json
 *   ├── manifest.json
 *   ├── quality-report.json
 *   └── intermediate/
 *       ├── data-requirements.json
 *       ├── dependency-analysis.json
 *       ├── strategy-candidates.json
 *       └── consolidation.json
 */
export function writeDataOutput(
  outputDir: string,
  dataPlan: TestDataPlanIR,
  manifest: TestDataPlannerManifest,
): void {
  const absDir = path.resolve(outputDir);
  fs.mkdirSync(absDir, { recursive: true });

  // test-data-plan-ir.json
  fs.writeFileSync(
    path.join(absDir, 'test-data-plan-ir.json'),
    JSON.stringify(dataPlan, null, 2),
    'utf-8',
  );

  // manifest.json
  fs.writeFileSync(
    path.join(absDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  // quality-report.json
  fs.writeFileSync(
    path.join(absDir, 'quality-report.json'),
    JSON.stringify(dataPlan.quality, null, 2),
    'utf-8',
  );
}

/**
 * Write intermediate analysis files.
 */
export function writeDataIntermediate(
  outputDir: string,
  dataRequirements: DataRequirementExtractionResult,
  dependencyAnalysis: DependencyAnalysisResult,
): void {
  const intermediateDir = path.join(path.resolve(outputDir), 'intermediate');
  fs.mkdirSync(intermediateDir, { recursive: true });

  fs.writeFileSync(
    path.join(intermediateDir, 'strategy-candidates.json'),
    JSON.stringify(dataRequirements, null, 2),
    'utf-8',
  );

  fs.writeFileSync(
    path.join(intermediateDir, 'consolidation.json'),
    JSON.stringify({
      dataCandidateCount: dataRequirements.dataCandidates.length,
      dependencyCandidateCount: dependencyAnalysis.dependencyCandidates.length,
      reuseCandidateCount: dependencyAnalysis.reuseCandidates.length,
    }, null, 2),
    'utf-8',
  );
}
