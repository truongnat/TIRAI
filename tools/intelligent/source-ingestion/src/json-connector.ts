import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import type {
  CanonicalContextChunk,
  CanonicalSourceDocument,
  LocalSourceInput,
  SourceArtifact,
  SourceConnector,
  SourceLocation,
} from './models.js';
import { locationKey, sha256, stableId } from './ids.js';
import { sanitizeMetadata } from './sanitizer.js';
import { SourceIngestionError } from './registry.js';

export const JSON_CONNECTOR_ID = 'local-json-connector';
export const JSON_CONNECTOR_VERSION = '1.0.0';

export class JsonSourceConnector implements SourceConnector {
  readonly id = JSON_CONNECTOR_ID;
  readonly version = JSON_CONNECTOR_VERSION;
  readonly kind = 'json';

  canOpen(input: LocalSourceInput): boolean {
    if (input.kind && input.kind !== this.kind) return false;
    const ext = extname(input.path).toLowerCase();
    return ext === '.json';
  }

  async open(input: LocalSourceInput): Promise<CanonicalSourceDocument> {
    const sourcePath = resolve(input.path);
    if (!this.canOpen(input)) {
      throw new SourceIngestionError('UNSUPPORTED_SOURCE', `JSON connector does not support "${input.path}".`);
    }
    try {
      const [bytes, sourceStats] = await Promise.all([readFile(sourcePath), stat(sourcePath)]);
      const raw = bytes.toString('utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new SourceIngestionError('INVALID_SOURCE', `Invalid JSON in "${basename(sourcePath)}": ${e instanceof Error ? e.message : String(e)}`);
      }
      const pretty = JSON.stringify(parsed, null, 2);
      const sourceHash = sha256(bytes);
      const sourceId = stableId('src', `${this.kind}:${sourcePath}`);
      const revisionId = stableId('rev', `${sourceId}:${sourceHash}`);
      const descriptor = {
        id: sourceId,
        kind: this.kind,
        displayName: basename(sourcePath),
        connectorId: this.id,
        connectorVersion: this.version,
      };
      const revision = { id: revisionId, contentHash: sourceHash, version: sourceHash };

      return buildJsonCanonicalDocument({
        sourceId,
        revisionId,
        sourceHash,
        displayName: basename(sourcePath),
        byteLength: sourceStats.size,
        raw,
        pretty,
        descriptor,
        revision,
      });
    } catch (error) {
      if (error instanceof SourceIngestionError) throw error;
      throw new SourceIngestionError(
        'INVALID_SOURCE',
        `Failed to ingest JSON source "${basename(sourcePath)}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

interface JsonCanonicalInput {
  sourceId: string;
  revisionId: string;
  sourceHash: string;
  displayName: string;
  byteLength: number;
  raw: string;
  pretty: string;
  descriptor: CanonicalSourceDocument['source'];
  revision: CanonicalSourceDocument['revision'];
}

function buildJsonCanonicalDocument(input: JsonCanonicalInput): CanonicalSourceDocument {
  const rootLocation: SourceLocation = {
    segments: [{ kind: 'document', value: input.displayName }],
  };
  const rootArtifactId = stableArtifactId(input.sourceId, input.revisionId, 'document', rootLocation, input.sourceHash);
  const artifacts: SourceArtifact[] = [
    {
      id: rootArtifactId,
      sourceId: input.sourceId,
      revisionId: input.revisionId,
      kind: 'document',
      location: rootLocation,
      mediaType: 'application/json',
      content: input.raw,
      contentHash: input.sourceHash,
      metadata: sanitizeMetadata({
        displayName: input.displayName,
        byteLength: input.byteLength,
      }),
    },
  ];

  const contexts: CanonicalContextChunk[] = [];
  // Split pretty JSON into chunks of ~1000 chars, preferring line breaks
  const chunks = splitJsonByLines(input.pretty, 1000);
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunkText = chunks[idx]!.trim();
    if (!chunkText) continue;
    const chunkLocation: SourceLocation = {
      segments: [...rootLocation.segments, { kind: 'json-block', value: String(idx) }],
    };
    const contentHash = sha256(chunkText);
    const artifactId = stableArtifactId(input.sourceId, input.revisionId, 'json-block', chunkLocation, contentHash);
    artifacts.push({
      id: artifactId,
      sourceId: input.sourceId,
      revisionId: input.revisionId,
      parentArtifactId: rootArtifactId,
      kind: 'json-block',
      location: chunkLocation,
      mediaType: 'application/json',
      content: chunkText,
      contentHash,
      metadata: sanitizeMetadata({ blockIndex: idx }),
    });
    contexts.push({
      schemaVersion: '1.0',
      id: stableId('ctx', `${input.sourceId}:${input.revisionId}:${artifactId}`),
      type: 'json-block',
      content: chunkText,
      contentHash,
      provenance: {
        sourceId: input.sourceId,
        revisionId: input.revisionId,
        artifactId,
        location: chunkLocation,
      },
      relations: [],
      metadata: sanitizeMetadata({ blockIndex: idx }),
    });
  }

  for (let i = 0; i < contexts.length; i++) {
    if (i > 0) contexts[i]!.relations.push({ type: 'continuation-previous', targetContextId: contexts[i - 1]!.id });
    if (i + 1 < contexts.length) contexts[i]!.relations.push({ type: 'continuation-next', targetContextId: contexts[i + 1]!.id });
  }

  return {
    schemaVersion: '1.0',
    source: input.descriptor,
    revision: input.revision,
    artifacts,
    contexts,
  };
}

function splitJsonByLines(pretty: string, size: number): string[] {
  const lines = pretty.split('\n');
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if ((current + '\n' + line).length > size && current) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function stableArtifactId(
  sourceId: string,
  revisionId: string,
  kind: string,
  location: SourceLocation,
  contentHash: string,
): string {
  return stableId('artifact', `${sourceId}:${revisionId}:${kind}:${locationKey(location)}:${contentHash}`);
}
