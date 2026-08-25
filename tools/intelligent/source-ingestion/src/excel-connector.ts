import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, extname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

import { inspectWorkbook } from 'workbook-inspector';
import { extractWorkbook } from 'cell-layout-extractor';
import { buildExcelContext } from 'excel-context-builder';

import type {
  CanonicalContextChunk,
  CanonicalSourceDocument,
  LocalSourceInput,
  SourceArtifact,
  SourceConnector,
  SourceLocation,
} from './models.js';
import { locationKey, sha256, stableId } from './ids.js';
import { assertNoRawCredentials, sanitizeMetadata } from './sanitizer.js';

export const EXCEL_CONNECTOR_ID = 'local-excel';
export const EXCEL_CONNECTOR_VERSION = '1.0.0';

export class ExcelSourceConnector implements SourceConnector {
  readonly id = EXCEL_CONNECTOR_ID;
  readonly version = EXCEL_CONNECTOR_VERSION;
  readonly kind = 'excel' as const;

  canOpen(input: LocalSourceInput): boolean {
    const extension = extname(input.path).toLowerCase();
    return extension === '.xlsx' || extension === '.xlsm';
  }

  async open(input: LocalSourceInput): Promise<CanonicalSourceDocument> {
    const filePath = resolve(input.path);
    const bytes = await readFile(filePath);
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const sourceId = stableId('src', `excel:${filePath}`);
    const revisionId = stableId('rev', `${sourceId}:${contentHash}`);
    const source = {
      id: sourceId,
      kind: 'excel' as const,
      displayName: basename(filePath),
      connectorId: this.id,
      connectorVersion: this.version,
    };
    const revision = { id: revisionId, contentHash };

    assertNoRawCredentials({ source, revision });
    const workspace = await mkdtemp(join(tmpdir(), 'tirai-source-ingestion-'));
    try {
      const workbook = await inspectWorkbook(filePath);
      const layout = await extractWorkbook(filePath);
      await writeFile(join(workspace, 'workbook.json'), JSON.stringify(workbook));
      await mkdir(join(workspace, 'layout'), { recursive: true });
      await writeFile(join(workspace, 'layout', 'full-extract.json'), JSON.stringify(layout));
      const contextPackage = await buildExcelContext(workspace);
      const artifacts: SourceArtifact[] = [];
      const contexts: CanonicalContextChunk[] = [];
      const rootLocation: SourceLocation = {
        segments: [{ kind: 'workbook', value: basename(filePath) }],
      };
      const rootId = stableId('artifact', `${revisionId}:workbook:${basename(filePath)}`);
      artifacts.push({
        id: rootId,
        sourceId,
        revisionId,
        kind: 'document',
        location: rootLocation,
        mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        content: '',
        contentHash,
        metadata: sanitizeMetadata({
          displayName: basename(filePath),
          extension: extname(filePath).toLowerCase(),
          byteLength: bytes.byteLength,
        }),
      });

      const contextIdsByChunk = contextPackage.chunks.map((chunk) =>
        stableId('ctx', `${sourceId}:${revisionId}:${chunk.id}`),
      );
      for (let index = 0; index < contextPackage.chunks.length; index++) {
        const chunk = contextPackage.chunks[index];
        const location: SourceLocation = {
          segments: [
            { kind: 'workbook', value: basename(filePath) },
            { kind: 'sheet', value: chunk.sheet.name },
            ...(chunk.range ? [{ kind: 'range', value: chunk.range }] : []),
          ],
        };
        const artifactId = stableId(
          'artifact',
          `${revisionId}:${locationKey(location)}:${chunk.id}`,
        );
        artifacts.push({
          id: artifactId,
          sourceId,
          revisionId,
          parentArtifactId: rootId,
          kind: 'context-block',
          location,
          mediaType: 'text/plain',
          content: chunk.content,
          contentHash: sha256(chunk.content),
          metadata: sanitizeMetadata({
            sheetName: chunk.sheet.name,
            sheetIndex: chunk.sheet.index,
            range: chunk.range ?? '',
            chunkType: chunk.type,
          }),
        });
        const relations = [];
        const previous = contextIdsByChunk[index - 1];
        const next = contextIdsByChunk[index + 1];
        if (previous) relations.push({ type: 'previous' as const, targetContextId: previous });
        if (next) relations.push({ type: 'next' as const, targetContextId: next });
        contexts.push({
          schemaVersion: '1.0',
          id: contextIdsByChunk[index],
          type: chunk.type,
          content: chunk.content,
          contentHash: sha256(chunk.content),
          provenance: { sourceId, revisionId, artifactId, location },
          relations,
          metadata: sanitizeMetadata({
            sheetName: chunk.sheet.name,
            sheetIndex: chunk.sheet.index,
            range: chunk.range ?? '',
            chunkType: chunk.type,
          }),
        });
      }
      return { schemaVersion: '1.0', source, revision, artifacts, contexts };
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
