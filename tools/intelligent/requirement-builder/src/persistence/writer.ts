// ---------------------------------------------------------------------------
// Output writer – persists Requirement IR, manifest, intermediate results
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  RequirementIR,
  RequirementManifest,
  RequirementCandidate,
  CandidateExtractionResult,
  RequirementConsolidationResult,
} from '../models.js';

/**
 * Write the complete requirement builder output to disk.
 *
 * Structure:
 *   outputDir/
 *   ├── requirement-ir.json
 *   ├── manifest.json
 *   ├── quality-report.json
 *   └── analysis/
 *       ├── candidate-extraction.json
 *       └── consolidation.json
 */
export function writeOutput(
  outputDir: string,
  requirementIR: RequirementIR,
  manifest: RequirementManifest,
): void {
  const absDir = path.resolve(outputDir);
  fs.mkdirSync(absDir, { recursive: true });

  // Write requirement-ir.json
  fs.writeFileSync(
    path.join(absDir, 'requirement-ir.json'),
    JSON.stringify(requirementIR, null, 2),
    'utf-8',
  );

  // Write manifest.json
  fs.writeFileSync(
    path.join(absDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  // Write quality-report.json (same as quality section of IR)
  fs.writeFileSync(
    path.join(absDir, 'quality-report.json'),
    JSON.stringify(requirementIR.quality, null, 2),
    'utf-8',
  );
}

/**
 * Write intermediate analysis files.
 */
export function writeAnalysis(
  outputDir: string,
  candidates: RequirementCandidate[],
  extractionResults: CandidateExtractionResult[],
  consolidationResult: RequirementConsolidationResult,
): void {
  const analysisDir = path.join(path.resolve(outputDir), 'analysis');
  fs.mkdirSync(analysisDir, { recursive: true });

  // Write candidate extraction results
  fs.writeFileSync(
    path.join(analysisDir, 'candidate-extraction.json'),
    JSON.stringify({
      totalCandidates: candidates.length,
      batches: extractionResults,
    }, null, 2),
    'utf-8',
  );

  // Write consolidation result
  fs.writeFileSync(
    path.join(analysisDir, 'consolidation.json'),
    JSON.stringify(consolidationResult, null, 2),
    'utf-8',
  );
}
