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

export const CSV_CONNECTOR_ID = 'local-csv-connector';
export const CSV_CONNECTOR_VERSION = '1.0.0';

export class CsvSourceConnector implements SourceConnector {
  readonly id = CSV_CONNECTOR_ID;
  readonly version = CSV_CONNECTOR_VERSION;
  readonly kind = 'csv';

  canOpen(input: LocalSourceInput): boolean {
    if (input.kind && input.kind !== this.kind) return false;
    const ext = extname(input.path).toLowerCase();
    return ext === '.csv';
  }

  async open(input: LocalSourceInput): Promise<CanonicalSourceDocument> {
    const sourcePath = resolve(input.path);
    if (!this.canOpen(input)) {
      throw new SourceIngestionError('UNSUPPORTED_SOURCE', `CSV connector does not support "${input.path}".`);
    }
    try {
      const [bytes, sourceStats] = await Promise.all([readFile(sourcePath), stat(sourcePath)]);
      const raw = bytes.toString('utf8');
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

      // Simple CSV parse: split by lines, then by comma (handle quoted fields minimally)
      const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length === 0) {
        throw new SourceIngestionError('INVALID_SOURCE', `CSV is empty: ${basename(sourcePath)}`);
      }
      // Use first line as header, rest as rows
      const rows: string[][] = lines.map(line => {
        // Simple CSV split handling quoted commas
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i]!;
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result;
      });

      return buildCsvCanonicalDocument({
        sourceId,
        revisionId,
        sourceHash,
        displayName: basename(sourcePath),
        byteLength: sourceStats.size,
        rows,
        raw,
        descriptor,
        revision,
      });
    } catch (error) {
      if (error instanceof SourceIngestionError) throw error;
      throw new SourceIngestionError(
        'INVALID_SOURCE',
        `Failed to ingest CSV source "${basename(sourcePath)}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

interface CsvCanonicalInput {
  sourceId: string;
  revisionId: string;
  sourceHash: string;
  displayName: string;
  byteLength: number;
  rows: string[][];
  raw: string;
  descriptor: CanonicalSourceDocument['source'];
  revision: CanonicalSourceDocument['revision'];
}

function buildCsvCanonicalDocument(input: CsvCanonicalInput): CanonicalSourceDocument {
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
      mediaType: 'text/csv',
      content: input.raw,
      contentHash: input.sourceHash,
      metadata: sanitizeMetadata({
        displayName: input.displayName,
        rowCount: input.rows.length,
        byteLength: input.byteLength,
      }),
    },
  ];

  const contexts: CanonicalContextChunk[] = [];

  for (let rowIdx = 0; rowIdx < input.rows.length; rowIdx++) {
    const row = input.rows[rowIdx]!;
    const rowText = row.join(' | ');
    const rowLocation: SourceLocation = {
      segments: [...rootLocation.segments, { kind: 'row', value: String(rowIdx) }],
    };
    const rowHash = sha256(`row:${rowIdx}|${rowText.slice(0, 200)}`);
    const rowArtifactId = stableArtifactId(input.sourceId, input.revisionId, 'row', rowLocation, rowHash);
    artifacts.push({
      id: rowArtifactId,
      sourceId: input.sourceId,
      revisionId: input.revisionId,
      parentArtifactId: rootArtifactId,
      kind: 'row',
      location: rowLocation,
      mediaType: 'text/csv',
      content: rowText,
      contentHash: rowHash,
      metadata: sanitizeMetadata({ rowIndex: rowIdx, columnCount: row.length }),
    });

    const contentHash = sha256(rowText);
    const artifactId = stableArtifactId(input.sourceId, input.revisionId, 'row-content', rowLocation, contentHash);
    artifacts.push({
      id: artifactId,
      sourceId: input.sourceId,
      revisionId: input.revisionId,
      parentArtifactId: rowArtifactId,
      kind: 'row-content',
      location: rowLocation,
      mediaType: 'text/csv',
      content: rowText,
      contentHash,
      metadata: sanitizeMetadata({ rowIndex: rowIdx }),
    });
    contexts.push({
      schemaVersion: '1.0',
      id: stableId('ctx', `${input.sourceId}:${input.revisionId}:${artifactId}`),
      type: 'row-content',
      content: rowText,
      contentHash,
      provenance: {
        sourceId: input.sourceId,
        revisionId: input.revisionId,
        artifactId,
        location: rowLocation,
      },
      relations: [],
      metadata: sanitizeMetadata({ rowIndex: rowIdx }),
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

function stableArtifactId(
  sourceId: string,
  revisionId: string,
  kind: string,
  location: SourceLocation,
  contentHash: string,
): string {
  return stableId('artifact', `${sourceId}:${revisionId}:${kind}:${locationKey(location)}:${contentHash}`);
}
