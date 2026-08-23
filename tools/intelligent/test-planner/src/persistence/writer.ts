// ---------------------------------------------------------------------------
// Test Planner – output writer
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  TestPlanIR,
  TestPlannerManifest,
  CoverageAnalysisResult,
  ScenarioCandidate,
  TestCaseCandidate,
} from '../models.js';

/**
 * Write the complete test planner output to disk.
 *
 * Structure:
 *   outputDir/
 *   ├── test-plan-ir.json
 *   ├── test-case-ir.json
 *   ├── manifest.json
 *   ├── quality-report.json
 *   └── intermediate/
 *       ├── coverage-analysis.json
 *       ├── scenario-candidates.json
 *       ├── test-case-candidates.json
 *       └── consolidation.json
 */
export function writeOutput(
  outputDir: string,
  testPlan: TestPlanIR,
  manifest: TestPlannerManifest,
): void {
  const absDir = path.resolve(outputDir);
  fs.mkdirSync(absDir, { recursive: true });

  // test-plan-ir.json (scope + coverage + scenarios + quality)
  const testPlanIR = {
    schemaVersion: testPlan.schemaVersion,
    scope: testPlan.scope,
    requirementCoverage: testPlan.requirementCoverage,
    scenarios: testPlan.scenarios,
    unresolved: testPlan.unresolved,
    quality: testPlan.quality,
  };
  fs.writeFileSync(
    path.join(absDir, 'test-plan-ir.json'),
    JSON.stringify(testPlanIR, null, 2),
    'utf-8',
  );

  // test-case-ir.json (test cases + data needs)
  const testCaseIR = {
    schemaVersion: testPlan.schemaVersion,
    testCases: testPlan.testCases,
    dataNeeds: testPlan.dataNeeds,
  };
  fs.writeFileSync(
    path.join(absDir, 'test-case-ir.json'),
    JSON.stringify(testCaseIR, null, 2),
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
    JSON.stringify(testPlan.quality, null, 2),
    'utf-8',
  );
}

/**
 * Write intermediate analysis files.
 */
export function writeIntermediate(
  outputDir: string,
  coverage: CoverageAnalysisResult,
  scenarios: ScenarioCandidate[],
  testCases: TestCaseCandidate[],
): void {
  const intermediateDir = path.join(path.resolve(outputDir), 'intermediate');
  fs.mkdirSync(intermediateDir, { recursive: true });

  fs.writeFileSync(
    path.join(intermediateDir, 'coverage-analysis.json'),
    JSON.stringify(coverage, null, 2),
    'utf-8',
  );

  fs.writeFileSync(
    path.join(intermediateDir, 'scenario-candidates.json'),
    JSON.stringify({ scenarios }, null, 2),
    'utf-8',
  );

  fs.writeFileSync(
    path.join(intermediateDir, 'test-case-candidates.json'),
    JSON.stringify({ testCases }, null, 2),
    'utf-8',
  );

  fs.writeFileSync(
    path.join(intermediateDir, 'consolidation.json'),
    JSON.stringify({
      scenarioCount: scenarios.length,
      testCaseCount: testCases.length,
    }, null, 2),
    'utf-8',
  );
}
