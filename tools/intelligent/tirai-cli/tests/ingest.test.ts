import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { runIngest } from '../src/commands/ingest.js';
import { runInit } from '../src/commands/init.js';
import { getWorkspacePaths } from '../src/workspace.js';

describe('spec-first ingestion defaults', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(tmpdir(), 'tirai-ingest-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('does not inspect application source unless the tester explicitly opts in', async () => {
    await runInit({ cwd: root });
    const appSource = path.join(root, 'src', 'routes');
    fs.mkdirSync(appSource, { recursive: true });
    fs.writeFileSync(
      path.join(appSource, 'index.tsx'),
      'export function App() { return null; }',
      'utf8',
    );
    const specPath = path.join(root, 'requirements.md');
    fs.writeFileSync(specPath, '# Login\nThe user can sign in with valid credentials.\n', 'utf8');

    await runIngest({ cwd: root, sourcePath: specPath });

    const paths = getWorkspacePaths(root);
    expect(fs.existsSync(path.join(paths.artifactsDir, 'source-intelligence.json'))).toBe(false);
    expect(fs.readFileSync(path.join(paths.sourcesDir, 'requirements.md'), 'utf8')).toContain(
      'The user can sign in',
    );
  });

  it('produces only raw artifacts and awaits the host agent for a markdown spec', async () => {
    await runInit({ cwd: root });
    const specPath = path.join(root, 'requirements.md');
    fs.writeFileSync(specPath, '# Login\nThe user can sign in with valid credentials.\n', 'utf8');

    await runIngest({ cwd: root, sourcePath: specPath });

    const paths = getWorkspacePaths(root);
    expect(fs.existsSync(path.join(paths.artifactsDir, 'ai-input.json'))).toBe(true);
    expect(fs.existsSync(path.join(paths.artifactsDir, 'context.json'))).toBe(true);
    // TIRAI performs no embedded AI analysis: the canonical contract must not
    // appear until the host agent produces and imports it.
    expect(fs.existsSync(path.join(paths.artifactsDir, 'contract.json'))).toBe(false);
  });
});
