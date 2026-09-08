import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeRawContextPackage, verifyRawContextPackage } from '../src/raw-context.js';
import type { CanonicalSourceDocument } from 'source-ingestion';

const doc: CanonicalSourceDocument = {
  schemaVersion: '1.0', source: { id: 'src-1', kind: 'markdown', displayName: 'spec.md', connectorId: 'markdown', connectorVersion: '1.0' }, revision: { id: 'rev-1', contentHash: 'source-hash' }, artifacts: [],
  contexts: [{ schemaVersion: '1.0', id: 'ctx-1', type: 'paragraph', content: 'Hello', contentHash: '185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969', provenance: { sourceId: 'src-1', revisionId: 'rev-1', artifactId: 'art-1', location: { segments: [{ kind: 'line', value: 1 }] } }, relations: [], metadata: {} }],
};

describe('raw context package', () => {
  it('writes deterministic provenance and verifies content hashes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-raw-'));
    const result = writeRawContextPackage(doc, dir);
    expect(result.contextCount).toBe(1);
    expect(JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')).contexts[0].file).toBe('modules/ungrouped/ctx-1.json');
    expect(JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')).modules[0].id).toBe('ungrouped');
    expect(verifyRawContextPackage(dir)).toEqual({ valid: true, errors: [] });
  });
});
