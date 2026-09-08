import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HtmlSourceConnector } from '../src/html-connector.js';

describe('HtmlSourceConnector', () => {
  it('preserves raw html, hash and provenance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tirai-html-'));
    const file = join(dir, 'spec.html');
    await writeFile(file, '<h1>Login</h1><p>User can sign in.</p>', 'utf8');
    const doc = await new HtmlSourceConnector().open({ path: file, kind: 'html' });
    expect(doc.source.kind).toBe('html');
    expect(doc.artifacts[0]?.mediaType).toBe('text/html');
    expect(doc.contexts[0]?.content).toContain('User can sign in');
    expect(doc.contexts[0]?.provenance.artifactId).toBe(doc.artifacts[0]?.id);
  });
});
