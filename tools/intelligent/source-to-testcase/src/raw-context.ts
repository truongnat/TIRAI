import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { CanonicalSourceDocument, CanonicalContextChunk } from 'source-ingestion';

export interface RawContextManifest {
  schemaVersion: '1.0';
  kind: 'tirai-raw-context';
  source: CanonicalSourceDocument['source'];
  revision: CanonicalSourceDocument['revision'];
  contexts: Array<Pick<CanonicalContextChunk, 'id' | 'type' | 'contentHash' | 'provenance' | 'parentContextId' | 'relations' | 'metadata'> & { file: string; module: string; characterCount: number; estimatedTokens: number }>;
  modules: Array<{ id: string; contextIds: string[]; characterCount: number; estimatedTokens: number }>;
  stats: { contextCount: number; characters: number; estimatedTokens: number };
}

export interface RawContextWriteResult { dir: string; manifestPath: string; files: string[]; contextCount: number; }

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function moduleFor(context: CanonicalContextChunk): string {
  const value = context.metadata.module ?? context.metadata.feature ?? context.metadata.businessFlow ?? context.metadata.sheet ?? context.metadata.heading;
  return String(value ?? 'ungrouped').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ungrouped';
}

/** Writes a connector-neutral, content-addressable snapshot without touching the source. */
export function writeRawContextPackage(doc: CanonicalSourceDocument, dir: string): RawContextWriteResult {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'contexts'), { recursive: true });
  const contexts = [...doc.contexts].sort((a, b) => a.id.localeCompare(b.id));
  const files: string[] = [];
  const entries = contexts.map((context) => {
    const module = moduleFor(context);
    const file = `modules/${module}/${context.id}.json`;
    const absolute = path.join(dir, file);
    writeJson(absolute, context);
    files.push(absolute);
    return { id: context.id, type: context.type, contentHash: context.contentHash, provenance: context.provenance, parentContextId: context.parentContextId, relations: context.relations, metadata: context.metadata, file, module, characterCount: context.content.length, estimatedTokens: Math.ceil(context.content.length / 4) };
  });
  const modules = [...new Set(entries.map((entry) => entry.module))].sort().map((id) => {
    const members = entries.filter((entry) => entry.module === id);
    return { id, contextIds: members.map((entry) => entry.id), characterCount: members.reduce((n, entry) => n + entry.characterCount, 0), estimatedTokens: members.reduce((n, entry) => n + entry.estimatedTokens, 0) };
  });
  const manifest: RawContextManifest = {
    schemaVersion: '1.0', kind: 'tirai-raw-context', source: doc.source, revision: doc.revision, contexts: entries, modules,
    stats: { contextCount: contexts.length, characters: contexts.reduce((n, c) => n + c.content.length, 0), estimatedTokens: contexts.reduce((n, c) => n + Math.ceil(c.content.length / 4), 0) },
  };
  const manifestPath = path.join(dir, 'manifest.json');
  writeJson(manifestPath, manifest);
  files.push(manifestPath);
  return { dir, manifestPath, files, contextCount: contexts.length };
}

export function verifyRawContextPackage(dir: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as RawContextManifest;
    for (const entry of manifest.contexts) {
      const context = JSON.parse(fs.readFileSync(path.join(dir, entry.file), 'utf8')) as CanonicalContextChunk;
      if (context.contentHash !== entry.contentHash || context.contentHash !== sha256(context.content)) errors.push(`${entry.id}: content hash mismatch`);
    }
  } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  return { valid: errors.length === 0, errors };
}
