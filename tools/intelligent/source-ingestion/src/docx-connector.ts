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

export const DOCX_CONNECTOR_ID = 'local-docx-connector';
export const DOCX_CONNECTOR_VERSION = '1.0.0';

export class DocxSourceConnector implements SourceConnector {
  readonly id = DOCX_CONNECTOR_ID;
  readonly version = DOCX_CONNECTOR_VERSION;
  readonly kind = 'docx';

  canOpen(input: LocalSourceInput): boolean {
    if (input.kind && input.kind !== this.kind) return false;
    const ext = extname(input.path).toLowerCase();
    return ext === '.docx';
  }

  async open(input: LocalSourceInput): Promise<CanonicalSourceDocument> {
    const sourcePath = resolve(input.path);
    if (!this.canOpen(input)) {
      throw new SourceIngestionError('UNSUPPORTED_SOURCE', `DOCX connector does not support "${input.path}".`);
    }
    try {
      const [bytes, sourceStats] = await Promise.all([readFile(sourcePath), stat(sourcePath)]);
      if (bytes.length > 50 * 1024 * 1024) {
        throw new SourceIngestionError('INVALID_SOURCE', `DOCX too large for MVP (max 50MB): ${basename(sourcePath)} is ${bytes.length} bytes`);
      }
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

      const { paragraphs } = await parseDocx(bytes, sourcePath);

      return buildDocxCanonicalDocument({
        sourceId,
        revisionId,
        sourceHash,
        displayName: basename(sourcePath),
        byteLength: sourceStats.size,
        paragraphs,
        descriptor,
        revision,
      });
    } catch (error) {
      if (error instanceof SourceIngestionError) throw error;
      throw new SourceIngestionError(
        'INVALID_SOURCE',
        `Failed to ingest DOCX source "${basename(sourcePath)}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function parseDocx(bytes: Buffer, sourcePath: string): Promise<{ paragraphs: string[] }> {
  try {
    const mammoth: any = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: bytes });
    const text: string = result.value || '';
    // Split by double newline into paragraphs, filter empty
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p: string) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (paragraphs.length === 0 && text.trim()) {
      return { paragraphs: [text.trim()] };
    }
    return { paragraphs };
  } catch (e) {
    throw new SourceIngestionError('INVALID_SOURCE', `Failed to parse DOCX "${basename(sourcePath)}": ${e instanceof Error ? e.message : String(e)}`);
  }
}

interface DocxCanonicalInput {
  sourceId: string;
  revisionId: string;
  sourceHash: string;
  displayName: string;
  byteLength: number;
  paragraphs: string[];
  descriptor: CanonicalSourceDocument['source'];
  revision: CanonicalSourceDocument['revision'];
}

function buildDocxCanonicalDocument(input: DocxCanonicalInput): CanonicalSourceDocument {
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
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      content: '',
      contentHash: input.sourceHash,
      metadata: sanitizeMetadata({
        displayName: input.displayName,
        byteLength: input.byteLength,
        paragraphCount: input.paragraphs.length,
      }),
    },
  ];

  const contexts: CanonicalContextChunk[] = [];
  const CHUNK_SIZE = 1000;

  for (let idx = 0; idx < input.paragraphs.length; idx++) {
    const paraText = input.paragraphs[idx] ?? '';
    const paraLocation: SourceLocation = {
      segments: [...rootLocation.segments, { kind: 'paragraph', value: String(idx) }],
    };
    const paraHash = sha256(`para:${idx}|${paraText.slice(0, 200)}`);
    const paraArtifactId = stableArtifactId(input.sourceId, input.revisionId, 'paragraph', paraLocation, paraHash);
    artifacts.push({
      id: paraArtifactId,
      sourceId: input.sourceId,
      revisionId: input.revisionId,
      parentArtifactId: rootArtifactId,
      kind: 'paragraph',
      location: paraLocation,
      mediaType: 'text/plain',
      content: '',
      contentHash: paraHash,
      metadata: sanitizeMetadata({ paragraphIndex: idx }),
    });

    const chunks = paraText.length <= CHUNK_SIZE ? [paraText] : splitByChunkSize(paraText, CHUNK_SIZE);
    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunkText = chunks[chunkIdx]!.trim();
      if (!chunkText) continue;
      const chunkLocation: SourceLocation = {
        segments: [...paraLocation.segments, { kind: 'paragraph-content', value: String(chunkIdx) }],
      };
      const contentHash = sha256(chunkText);
      const artifactId = stableArtifactId(input.sourceId, input.revisionId, 'paragraph-content', chunkLocation, contentHash);
      artifacts.push({
        id: artifactId,
        sourceId: input.sourceId,
        revisionId: input.revisionId,
        parentArtifactId: paraArtifactId,
        kind: 'paragraph-content',
        location: chunkLocation,
        mediaType: 'text/plain',
        content: chunkText,
        contentHash,
        metadata: sanitizeMetadata({ paragraphIndex: idx, chunkIndex: chunkIdx, charCount: chunkText.length }),
      });
      contexts.push({
        schemaVersion: '1.0',
        id: stableId('ctx', `${input.sourceId}:${input.revisionId}:${artifactId}`),
        type: 'paragraph-content',
        content: chunkText,
        contentHash,
        provenance: {
          sourceId: input.sourceId,
          revisionId: input.revisionId,
          artifactId,
          location: chunkLocation,
        },
        relations: [],
        metadata: sanitizeMetadata({ paragraphIndex: idx, chunkIndex: chunkIdx }),
      });
    }
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

function splitByChunkSize(text: string, size: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const lastDot = text.lastIndexOf('.', end);
      if (lastDot > start + size * 0.5) end = lastDot + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
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
