import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownSourceConnector } from 'source-ingestion';
import { analyzeCanonicalContext } from '../src/analyzer.js';
import { buildFakeProvider, chunkEntity } from './fixtures/helpers.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('canonical semantic analyzer boundary', () => {
  it('accepts Markdown canonical contexts without spreadsheet provenance and preserves lineage', async () => {
    const directory = await mkdtemp(resolve('/tmp', 'tirai-semantic-source-'));
    directories.push(directory);
    const path = resolve(directory, 'spec.md');
    await writeFile(path, '# Authentication\n\nThe user must sign in before viewing the dashboard.\n', 'utf8');
    const source = await new MarkdownSourceConnector().open({ path });
    const contextId = source.contexts[0]!.id;
    const provider = buildFakeProvider([
      {
        contextId,
        sections: [],
        entities: [chunkEntity({ localId: 'entity-1', name: 'Authentication', type: 'capability', provenance: [{ contextId }] })],
        flows: [],
        rules: [],
        relationships: [],
        unresolved: [],
      },
    ]);

    const semantic = await analyzeCanonicalContext(source, provider);
    const provenance = semantic.entities[0]!.provenance[0]!;
    expect(semantic.status).toBe('complete');
    expect(provenance.sourceId).toBe(source.source.id);
    expect(provenance.revisionId).toBe(source.revision.id);
    expect(provenance.artifactId).toBe(source.contexts[0]!.provenance.artifactId);
    expect(provenance.location?.segments.some((segment) => segment.kind === 'heading')).toBe(true);
    expect(provenance.sheet).toBeUndefined();
    expect(semantic.document.source?.kind).toBe('markdown');
  });

  it('fails closed when a canonical context is stale', async () => {
    const directory = await mkdtemp(resolve('/tmp', 'tirai-semantic-source-'));
    directories.push(directory);
    const path = resolve(directory, 'stale.md');
    await writeFile(path, '# Requirement\n\nThe account must be active.\n', 'utf8');
    const source = await new MarkdownSourceConnector().open({ path });
    source.contexts[0]!.provenance.revisionId = 'rev_stale';
    await expect(analyzeCanonicalContext(source, buildFakeProvider([]))).rejects.toMatchObject({ code: 'SOURCE_REVISION_MISMATCH' });
  });
});
