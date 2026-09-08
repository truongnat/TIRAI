import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import type { CanonicalSourceDocument, LocalSourceInput, SourceConnector } from './models.js';
import { sha256, stableId } from './ids.js';
import { SourceIngestionError } from './registry.js';

export class HtmlSourceConnector implements SourceConnector {
  readonly id = 'local-html-connector'; readonly version = '1.0.0'; readonly kind = 'html';
  canOpen(input: LocalSourceInput): boolean { return (!input.kind || input.kind === 'html') && ['.html', '.htm'].includes(extname(input.path).toLowerCase()); }
  async open(input: LocalSourceInput): Promise<CanonicalSourceDocument> {
    if (!this.canOpen(input)) throw new SourceIngestionError('UNSUPPORTED_SOURCE', `HTML connector does not support "${input.path}".`);
    const sourcePath = resolve(input.path); const [bytes, stats] = await Promise.all([readFile(sourcePath), stat(sourcePath)]); const content = bytes.toString('utf8'); const contentHash = sha256(bytes); const sourceId = stableId('src', `html:${sourcePath}`); const revisionId = stableId('rev', `${sourceId}:${contentHash}`); const artifactId = stableId('art', `${sourceId}:document`); const contextId = stableId('ctx', `${artifactId}:body`);
    return { schemaVersion: '1.0', source: { id: sourceId, kind: 'html', displayName: basename(sourcePath), connectorId: this.id, connectorVersion: this.version }, revision: { id: revisionId, contentHash, version: contentHash }, artifacts: [{ id: artifactId, sourceId, revisionId, kind: 'document', location: { segments: [{ kind: 'file', value: basename(sourcePath) }] }, mediaType: 'text/html', content, contentHash, metadata: { byteLength: stats.size } }], contexts: [{ schemaVersion: '1.0', id: contextId, type: 'document', content, contentHash, provenance: { sourceId, revisionId, artifactId, location: { segments: [{ kind: 'file', value: basename(sourcePath) }] } }, relations: [], metadata: { byteLength: stats.size } }] };
  }
}
