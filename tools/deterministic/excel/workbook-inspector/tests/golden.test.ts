// ---------------------------------------------------------------------------
// Golden / snapshot test – compares inspector output against expected.json
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as fpath from 'node:path';
import { inspectWorkbook } from '../src/inspector.js';
import { fixturePath } from './fixtures.js';

const GOLDEN_DIR = fpath.join(import.meta.dirname, 'fixtures');
const EXPECTED_PATH = fpath.join(GOLDEN_DIR, 'expected.json');

/**
 * Fields that may vary between runs or environments and should be excluded
 * from comparison.
 */
const NON_DETERMINISTIC_PATHS: string[][] = [
  ['file', 'path'],       // absolute path depends on where tests run
  ['file', 'sizeBytes'],  // may vary slightly by platform / exceljs version
];

/** Remove non-deterministic fields from a deep-cloned metadata object. */
function stripNonDeterministic(obj: unknown): unknown {
  const clone = JSON.parse(JSON.stringify(obj));
  for (const pathSegments of NON_DETERMINISTIC_PATHS) {
    let current: Record<string, unknown> = clone;
    for (let i = 0; i < pathSegments.length - 1; i++) {
      current = current[pathSegments[i]] as Record<string, unknown>;
      if (!current) break;
    }
    if (current) {
      delete current[pathSegments[pathSegments.length - 1]];
    }
  }
  return clone;
}

describe('golden test', () => {
  it('output matches expected.json for with-properties.xlsx', async () => {
    const meta = await inspectWorkbook(fixturePath('with-properties.xlsx'));
    const actual = stripNonDeterministic(meta);

    // If expected.json does not exist yet, generate it.
    if (!fs.existsSync(EXPECTED_PATH)) {
      fs.writeFileSync(EXPECTED_PATH, JSON.stringify(actual, null, 2) + '\n');
    }

    const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf-8'));
    expect(actual).toEqual(expected);
  });

  it('can regenerate expected.json when requested', async () => {
    // This test simply verifies the regeneration path works.
    const meta = await inspectWorkbook(fixturePath('with-properties.xlsx'));
    const actual = stripNonDeterministic(meta);
    fs.writeFileSync(EXPECTED_PATH, JSON.stringify(actual, null, 2) + '\n');
    const regenerated = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf-8'));
    expect(regenerated).toEqual(actual);
  });
});
