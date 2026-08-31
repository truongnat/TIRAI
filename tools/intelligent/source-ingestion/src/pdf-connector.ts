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

export const PDF_CONNECTOR_ID = 'local-pdf-connector';
export const PDF_CONNECTOR_VERSION = '1.0.0';

export class PdfSourceConnector implements SourceConnector {
  readonly id = PDF_CONNECTOR_ID;
  readonly version = PDF_CONNECTOR_VERSION;
  readonly kind = 'pdf';

  canOpen(input: LocalSourceInput): boolean {
    if (input.kind && input.kind !== this.kind) return false;
    const extension = extname(input.path).toLowerCase();
    return extension === '.pdf';
  }

  async open(input: LocalSourceInput): Promise<CanonicalSourceDocument> {
    const sourcePath = resolve(input.path);
    if (!this.canOpen(input)) {
      throw new SourceIngestionError('UNSUPPORTED_SOURCE', `PDF connector does not support "${input.path}".`);
    }
    try {
      const [bytes, sourceStats] = await Promise.all([readFile(sourcePath), stat(sourcePath)]);

      if (bytes.length > 50 * 1024 * 1024) {
        throw new SourceIngestionError('INVALID_SOURCE', `PDF too large for MVP (max 50MB): ${basename(sourcePath)} is ${bytes.length} bytes`);
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

      const { textPerPage, numPages } = await parsePdf(bytes, sourcePath);

      if (numPages > 100) {
        throw new SourceIngestionError('INVALID_SOURCE', `PDF too large for MVP (max 100 pages): ${basename(sourcePath)} has ${numPages} pages`);
      }

      return buildPdfCanonicalDocument({
        sourceId,
        revisionId,
        sourceHash,
        displayName: basename(sourcePath),
        byteLength: sourceStats.size,
        textPerPage,
        numPages,
        descriptor,
        revision,
      });
    } catch (error) {
      if (error instanceof SourceIngestionError) throw error;
      throw new SourceIngestionError(
        'INVALID_SOURCE',
        `Failed to ingest PDF source "${basename(sourcePath)}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function parsePdf(bytes: Buffer, sourcePath: string): Promise<{ textPerPage: string[]; numPages: number }> {
  try {
    const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      verbosity: 0,
      isEvalSupported: false,
      useWorkerFetch: false,
      disableWorker: true,
    });
    const pdf = await loadingTask.promise;
    const numPages: number = pdf.numPages;
    const textPerPage: string[] = [];
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strs: string[] = (content.items as Array<{ str: string }>).map((it) => it.str);
      const pageText = strs.join(' ').replace(/\s+/g, ' ').trim();
      textPerPage.push(pageText);
    }
    return { textPerPage, numPages };
  } catch (e) {
    throw new SourceIngestionError('INVALID_SOURCE', `Failed to parse PDF "${basename(sourcePath)}": ${e instanceof Error ? e.message : String(e)}`);
  }
}

interface PdfCanonicalInput {
  sourceId: string;
  revisionId: string;
  sourceHash: string;
  displayName: string;
  byteLength: number;
  textPerPage: string[];
  numPages: number;
  descriptor: CanonicalSourceDocument['source'];
  revision: CanonicalSourceDocument['revision'];
}

function buildPdfCanonicalDocument(input: PdfCanonicalInput): CanonicalSourceDocument {
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
      mediaType: 'application/pdf',
      content: '',
      contentHash: input.sourceHash,
      metadata: sanitizeMetadata({
        displayName: input.displayName,
        pageCount: input.numPages,
        byteLength: input.byteLength,
      }),
    },
  ];

  const contexts: CanonicalContextChunk[] = [];
  const CHUNK_SIZE = 1000;

  for (let pageIdx = 0; pageIdx < input.textPerPage.length; pageIdx++) {
    const pageNum = pageIdx + 1;
    const pageText = input.textPerPage[pageIdx] ?? '';
    const pageLocation: SourceLocation = {
      segments: [...rootLocation.segments, { kind: 'page', value: String(pageNum) }],
    };
    const pageHash = sha256(`page:${pageNum}|${pageText.slice(0, 200)}`);
    const pageArtifactId = stableArtifactId(input.sourceId, input.revisionId, 'page', pageLocation, pageHash);
    artifacts.push({
      id: pageArtifactId,
      sourceId: input.sourceId,
      revisionId: input.revisionId,
      parentArtifactId: rootArtifactId,
      kind: 'page',
      location: pageLocation,
      mediaType: 'text/plain',
      content: '',
      contentHash: pageHash,
      metadata: sanitizeMetadata({
        pageNumber: pageNum,
        pageCount: input.numPages,
      }),
    });

    const chunks = pageText.length <= CHUNK_SIZE ? [pageText] : splitByChunkSize(pageText, CHUNK_SIZE);
    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunkText = chunks[chunkIdx]!.trim();
      if (!chunkText) continue;
      const chunkLocation: SourceLocation = {
        segments: [...pageLocation.segments, { kind: 'page-content', value: String(chunkIdx) }, { kind: 'char-range', value: `${pageNum}:${chunkIdx}` }],
      };
      const contentHash = sha256(chunkText);
      const artifactId = stableArtifactId(input.sourceId, input.revisionId, 'page-content', chunkLocation, contentHash);
      artifacts.push({
        id: artifactId,
        sourceId: input.sourceId,
        revisionId: input.revisionId,
        parentArtifactId: pageArtifactId,
        kind: 'page-content',
        location: chunkLocation,
        mediaType: 'text/plain',
        content: chunkText,
        contentHash,
        metadata: sanitizeMetadata({
          pageNumber: pageNum,
          chunkIndex: chunkIdx,
          charCount: chunkText.length,
        }),
      });
      contexts.push({
        schemaVersion: '1.0',
        id: stableId('ctx', `${input.sourceId}:${input.revisionId}:${artifactId}`),
        type: 'page-content',
        content: chunkText,
        contentHash,
        provenance: {
          sourceId: input.sourceId,
          revisionId: input.revisionId,
          artifactId,
          location: chunkLocation,
        },
        relations: [],
        metadata: sanitizeMetadata({
          pageNumber: pageNum,
          chunkIndex: chunkIdx,
        }),
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
