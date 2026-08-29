import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildExcelContext, type ExcelContextPackage } from 'excel-context-builder';
import { extractWorkbook } from 'cell-layout-extractor';
import { inspectWorkbook } from 'workbook-inspector';
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

export const EXCEL_CONNECTOR_ID = 'local-excel-connector';
export const EXCEL_CONNECTOR_VERSION = '1.0.0';

export class ExcelSourceConnector implements SourceConnector {
  readonly id = EXCEL_CONNECTOR_ID;
  readonly version = EXCEL_CONNECTOR_VERSION;
  readonly kind = 'excel';

  canOpen(input: LocalSourceInput): boolean {
    if (input.kind && input.kind !== this.kind) return false;
    const extension = extname(input.path).toLowerCase();
    return extension === '.xlsx' || extension === '.xlsm';
  }

  async open(input: LocalSourceInput): Promise<CanonicalSourceDocument> {
    const sourcePath = resolve(input.path);
    const extension = extname(sourcePath).toLowerCase();
    if (!this.canOpen(input)) {
      throw new SourceIngestionError('UNSUPPORTED_SOURCE', `Excel connector does not support "${input.path}".`);
    }

    try {
      const [sourceBytes, sourceStats, workbook, layout] = await Promise.all([
        readFile(sourcePath),
        stat(sourcePath),
        inspectWorkbook(sourcePath),
        (async () => extractWorkbook(sourcePath))(),
      ]);
      const sourceHash = sha256(sourceBytes);
      const sourceId = stableId('src', `${this.kind}:${sourcePath}`);
      const revisionId = stableId('rev', `${sourceId}:${sourceHash}`);
      const revision = { id: revisionId, contentHash: sourceHash, version: sourceHash };
      const descriptor = {
        id: sourceId,
        kind: this.kind,
        displayName: basename(sourcePath),
        connectorId: this.id,
        connectorVersion: this.version,
      };

      const contextPackage = await this.buildContextPackage(workbook, layout);
      return buildExcelCanonicalDocument({
        sourceId,
        revisionId,
        sourceHash,
        displayName: basename(sourcePath),
        extension,
        byteLength: sourceStats.size,
        workbook,
        contextPackage,
        descriptor,
        revision,
      });
    } catch (error) {
      if (error instanceof SourceIngestionError) throw error;
      throw new SourceIngestionError(
        'INVALID_SOURCE',
        `Failed to ingest Excel source "${basename(sourcePath)}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async buildContextPackage(
    workbook: Awaited<ReturnType<typeof inspectWorkbook>>,
    layout: Awaited<ReturnType<typeof extractWorkbook>>,
  ): Promise<ExcelContextPackage> {
    const handoffDir = await mkdtemp(join(tmpdir(), 'tirai-excel-context-'));
    try {
      await mkdir(join(handoffDir, 'layout'), { recursive: true });
      await writeFile(join(handoffDir, 'workbook.json'), JSON.stringify(workbook), 'utf8');
      await writeFile(join(handoffDir, 'layout', 'full-extract.json'), JSON.stringify(layout), 'utf8');
      return await buildExcelContext(handoffDir);
    } finally {
      await rm(handoffDir, { recursive: true, force: true });
    }
  }
}

interface ExcelCanonicalInput {
  sourceId: string;
  revisionId: string;
  sourceHash: string;
  displayName: string;
  extension: string;
  byteLength: number;
  workbook: Awaited<ReturnType<typeof inspectWorkbook>>;
  contextPackage: ExcelContextPackage;
  descriptor: CanonicalSourceDocument['source'];
  revision: CanonicalSourceDocument['revision'];
}

function buildExcelCanonicalDocument(input: ExcelCanonicalInput): CanonicalSourceDocument {
  const rootLocation: SourceLocation = {
    segments: [{ kind: 'workbook', value: input.displayName }],
  };
  const rootArtifactId = stableArtifactId(input.sourceId, input.revisionId, 'workbook', rootLocation, input.sourceHash);
  const artifacts: SourceArtifact[] = [{
    id: rootArtifactId,
    sourceId: input.sourceId,
    revisionId: input.revisionId,
    kind: 'workbook',
    location: rootLocation,
    mediaType: input.extension === '.xlsm'
      ? 'application/vnd.ms-excel.sheet.macroEnabled.12'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    content: '',
    contentHash: input.sourceHash,
    metadata: sanitizeMetadata({
      displayName: input.displayName,
      extension: input.extension,
      mediaType: input.extension,
      byteLength: input.byteLength,
    }),
  }];

  const sheetArtifactIds = new Map<string, string>();
  for (const sheet of input.contextPackage.sheets) {
    const location: SourceLocation = {
      segments: [
        ...rootLocation.segments,
        { kind: 'sheet', value: sheet.name },
      ],
    };
    const contentHash = sha256(`${sheet.index}|${sheet.name}|${sheet.dimension ?? ''}`);
    const artifactId = stableArtifactId(input.sourceId, input.revisionId, 'sheet', location, contentHash);
    sheetArtifactIds.set(sheet.name, artifactId);
    artifacts.push({
      id: artifactId,
      sourceId: input.sourceId,
      revisionId: input.revisionId,
      parentArtifactId: rootArtifactId,
      kind: 'sheet',
      location,
      mediaType: 'text/plain',
      content: '',
      contentHash,
      metadata: sanitizeMetadata({
        sheetName: sheet.name,
        sheetIndex: sheet.index,
        range: sheet.dimension ?? '',
      }),
    });
  }

  const contexts: CanonicalContextChunk[] = [];
  for (const chunk of input.contextPackage.chunks) {
    const sheetArtifactId = sheetArtifactIds.get(chunk.sheet.name);
    if (!sheetArtifactId) {
      throw new SourceIngestionError('INVALID_SOURCE', `Context chunk references unknown sheet "${chunk.sheet.name}".`);
    }
    const location: SourceLocation = {
      segments: [
        ...rootLocation.segments,
        { kind: 'sheet', value: chunk.sheet.name },
        ...(chunk.range ? [{ kind: 'range', value: chunk.range }] : []),
      ],
    };
    const contentHash = sha256(chunk.content);
    const artifactId = stableArtifactId(input.sourceId, input.revisionId, 'context-chunk', location, contentHash);
    artifacts.push({
      id: artifactId,
      sourceId: input.sourceId,
      revisionId: input.revisionId,
      parentArtifactId: sheetArtifactId,
      kind: 'context-chunk',
      location,
      mediaType: 'text/plain',
      content: chunk.content,
      contentHash,
      metadata: sanitizeMetadata({
        sheetName: chunk.sheet.name,
        sheetIndex: chunk.sheet.index,
        range: chunk.range ?? '',
        chunkType: chunk.type,
      }),
    });
    contexts.push({
      schemaVersion: '1.0',
      id: stableId('ctx', `${input.sourceId}:${input.revisionId}:${artifactId}`),
      type: chunk.type,
      content: chunk.content,
      contentHash,
      provenance: {
        sourceId: input.sourceId,
        revisionId: input.revisionId,
        artifactId,
        location,
      },
      relations: [],
      metadata: sanitizeMetadata({
        sheetName: chunk.sheet.name,
        sheetIndex: chunk.sheet.index,
        range: chunk.range ?? '',
        chunkType: chunk.type,
      }),
    });
  }

  // Preserve the existing deterministic continuation order without exposing
  // Excel's relation shape to canonical consumers.
  for (const [index, context] of contexts.entries()) {
    if (index > 0 && contexts[index - 1]) {
      context.relations.push({ type: 'continuation-previous', targetContextId: contexts[index - 1]!.id });
    }
    if (index + 1 < contexts.length && contexts[index + 1]) {
      context.relations.push({ type: 'continuation-next', targetContextId: contexts[index + 1]!.id });
    }
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
