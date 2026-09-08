import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { getWorkspacePaths } from '../src/workspace.js';

describe('workspace layout', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(tmpdir(), 'tirai-workspace-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('separates artifacts (canonical) from outputs (export)', () => {
    const paths = getWorkspacePaths(tmp);
    expect(paths.artifactsDir).toContain('artifacts');
    expect(paths.outputsDir).toContain('outputs');
    expect(paths.artifactsDir).not.toBe(paths.outputsDir);
  });

  it('has separate output dirs for each export format', () => {
    const paths = getWorkspacePaths(tmp);
    expect(paths.outputsJsonDir).toContain('outputs/json');
    expect(paths.outputsExcelDir).toContain('outputs/excel');
    expect(paths.outputsPdfDir).toContain('outputs/pdf');
    expect(paths.outputsDocxDir).toContain('outputs/docx');
    expect(paths.outputsMarkdownDir).toContain('outputs/markdown');
  });

  it('has specs dir separate from artifacts', () => {
    const paths = getWorkspacePaths(tmp);
    expect(paths.specsDir).toContain('specs');
    expect(paths.specsDir).not.toContain('artifacts');
  });

  it('has canonical artifact paths for IR layers', () => {
    const paths = getWorkspacePaths(tmp);
    expect(paths.requirementsPath).toContain('artifacts/requirements.json');
    expect(paths.testPlanPath).toContain('artifacts/test-plan.json');
    expect(paths.testCasesPath).toContain('artifacts/testcases.json');
  });
});
