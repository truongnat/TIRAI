// ---------------------------------------------------------------------------
// TIRAI — Specification registry and commands
// ---------------------------------------------------------------------------
// Per TIRAI v1 spec §5: specifications are managed with provenance tracking.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { requireWorkspace, ensureDir } from '../workspace.js';
import { loadConfig } from '../config.js';
import { updateState, loadState } from '../state.js';
import { CliError } from '../errors.js';

export interface SpecEntry {
  id: string;
  name: string;
  sourceType: string;
  sourceRef: string;
  revisionFingerprint: string;
  language: string;
  domain: string;
  priority: string;
  ingestedAt: string;
}

export interface SpecRegistry {
  specs: SpecEntry[];
}

export interface SpecAddOptions {
  cwd: string;
  sourcePath: string;
  name?: string;
  language?: string;
  domain?: string;
  priority?: string;
  json?: boolean;
}

export interface SpecListOptions {
  cwd: string;
  json?: boolean;
}

export interface SpecInspectOptions {
  cwd: string;
  specId: string;
  json?: boolean;
}

function fingerprintFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return 'sha256:' + createHash('sha256').update(content).digest('hex');
}

function generateSpecId(sourcePath: string): string {
  const base = path.basename(sourcePath, path.extname(sourcePath));
  const hash = createHash('sha256').update(sourcePath).digest('hex').slice(0, 8);
  return 'spec-' + base + '-' + hash;
}

function detectSourceType(sourcePath: string): string {
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === '.xlsx' || ext === '.xlsm') return 'xlsx';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.csv') return 'csv';
  if (ext === '.json') return 'json';
  try {
    const u = new URL(sourcePath);
    if (u.protocol === 'http:' || u.protocol === 'https:') return 'url';
  } catch { /* not a url */ }
  return 'unknown';
}

export async function runSpecAdd(opts: SpecAddOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  loadConfig(paths);

  const isUrlSource = (() => {
    try {
      const u = new URL(opts.sourcePath);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  })();

  const absSource = isUrlSource ? opts.sourcePath : path.resolve(opts.cwd, opts.sourcePath);
  if (!isUrlSource && !fs.existsSync(absSource)) {
    throw new CliError('SOURCE_NOT_FOUND', 'Source not found: ' + opts.sourcePath);
  }

  const sourceType = detectSourceType(opts.sourcePath);
  const id = generateSpecId(opts.sourcePath);
  const fingerprint = isUrlSource
    ? 'sha256:' + createHash('sha256').update(opts.sourcePath).digest('hex')
    : fingerprintFile(absSource);

  const entry: SpecEntry = {
    id,
    name: opts.name ?? path.basename(opts.sourcePath, path.extname(opts.sourcePath)),
    sourceType,
    sourceRef: isUrlSource ? opts.sourcePath : path.relative(paths.root, absSource),
    revisionFingerprint: fingerprint,
    language: opts.language ?? 'en',
    domain: opts.domain ?? 'default',
    priority: opts.priority ?? 'primary',
    ingestedAt: new Date().toISOString(),
  };

  const registry = loadSpecRegistry(paths);
  const existing = registry.specs.find((s) => s.revisionFingerprint === fingerprint);
  if (existing) {
    throw new CliError(
      'SOURCE_INPUT_ERROR',
      'Spec already registered: ' + existing.id + ' (' + existing.name + ')',
      'Use `tirai spec list` to see registered specs.',
    );
  }

  registry.specs.push(entry);
  saveSpecRegistry(paths, registry);

  if (!isUrlSource) {
    ensureDir(paths.specsDir);
    const dest = path.join(paths.specsDir, path.basename(absSource));
    fs.copyFileSync(absSource, dest);
  }

  updateState(paths, (s) => ({
    ...s,
    specRegistry: {
      count: registry.specs.length,
      updatedAt: new Date().toISOString(),
    },
  }));

  if (opts.json) {
    console.log(JSON.stringify(entry, null, 2));
  } else {
    console.log('Spec registered: ' + entry.id);
    console.log('  Name:   ' + entry.name);
    console.log('  Type:   ' + entry.sourceType);
    console.log('  Source: ' + entry.sourceRef);
    console.log('  Hash:   ' + entry.revisionFingerprint.slice(0, 16) + '...');
  }
}

export async function runSpecList(opts: SpecListOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const registry = loadSpecRegistry(paths);

  if (opts.json) {
    console.log(JSON.stringify(registry, null, 2));
  } else {
    console.log('Registered specs: ' + registry.specs.length);
    for (const spec of registry.specs) {
      console.log('  ' + spec.id + ' (' + spec.sourceType + ') - ' + spec.name);
    }
  }
}

export async function runSpecInspect(opts: SpecInspectOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const registry = loadSpecRegistry(paths);
  const spec = registry.specs.find((s) => s.id === opts.specId);

  if (!spec) {
    throw new CliError('SOURCE_NOT_FOUND', 'Spec not found: ' + opts.specId);
  }

  if (opts.json) {
    console.log(JSON.stringify(spec, null, 2));
  } else {
    console.log('Spec: ' + spec.id);
    console.log('  Name:      ' + spec.name);
    console.log('  Type:      ' + spec.sourceType);
    console.log('  Source:    ' + spec.sourceRef);
    console.log('  Fingerprint: ' + spec.revisionFingerprint);
    console.log('  Language:  ' + spec.language);
    console.log('  Domain:    ' + spec.domain);
    console.log('  Priority:  ' + spec.priority);
    console.log('  Ingested:  ' + spec.ingestedAt);
  }
}

export function loadSpecRegistry(paths: { specsIndexPath: string }): SpecRegistry {
  try {
    if (fs.existsSync(paths.specsIndexPath)) {
      const raw = JSON.parse(fs.readFileSync(paths.specsIndexPath, 'utf8'));
      return raw as SpecRegistry;
    }
  } catch {
    // ignore
  }
  return { specs: [] };
}

export function saveSpecRegistry(paths: { specsIndexPath: string }, registry: SpecRegistry): void {
  ensureDir(path.dirname(paths.specsIndexPath));
  fs.writeFileSync(paths.specsIndexPath, JSON.stringify(registry, null, 2), 'utf8');
}
