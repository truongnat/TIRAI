import { readFile } from 'node:fs/promises';
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
import { assertNoRawCredentials, sanitizeMetadata } from './sanitizer.js';

export const MARKDOWN_CONNECTOR_ID = 'local-markdown';
export const MARKDOWN_CONNECTOR_VERSION = '1.0.0';

interface Heading {
  artifactId: string;
  level: number;
  title: string;
  line: number;
}

export class MarkdownSourceConnector implements SourceConnector {
  readonly id = MARKDOWN_CONNECTOR_ID;
  readonly version = MARKDOWN_CONNECTOR_VERSION;
  readonly kind = 'markdown' as const;

  canOpen(input: LocalSourceInput): boolean {
    const extension = extname(input.path).toLowerCase();
    return extension === '.md' || extension === '.markdown';
  }

  async open(input: LocalSourceInput): Promise<CanonicalSourceDocument> {
    const filePath = resolve(input.path);
    const content = await readFile(filePath, 'utf8');
    const contentHash = sha256(content);
    const sourceId = stableId('src', `markdown:${filePath}`);
    const revisionId = stableId('rev', `${sourceId}:${contentHash}`);
    const source = {
      id: sourceId,
      kind: 'markdown' as const,
      displayName: basename(filePath),
      connectorId: this.id,
      connectorVersion: this.version,
    };
    const revision = { id: revisionId, contentHash };
    assertNoRawCredentials({ source, revision });
    const rootLocation: SourceLocation = {
      segments: [{ kind: 'document', value: basename(filePath) }],
    };
    const rootId = stableId('artifact', `${revisionId}:document:${basename(filePath)}`);
    const artifacts: SourceArtifact[] = [
      {
        id: rootId,
        sourceId,
        revisionId,
        kind: 'document',
        location: rootLocation,
        mediaType: 'text/markdown',
        content,
        contentHash,
        metadata: sanitizeMetadata({
          displayName: basename(filePath),
          extension: extname(filePath).toLowerCase(),
          byteLength: Buffer.byteLength(content, 'utf8'),
        }),
      },
    ];

    const lines = content.split(/\r?\n/);
    const headings: Heading[] = [];
    const contexts: CanonicalContextChunk[] = [];
    let blockStart = 0;
    let blockLines: string[] = [];
    let blockIndex = 0;
    let previousContextId: string | undefined;

    const flushBlock = () => {
      while (blockLines.length > 0 && blockLines[0].trim() === '') blockLines.shift();
      while (blockLines.length > 0 && blockLines[blockLines.length - 1].trim() === '')
        blockLines.pop();
      if (blockLines.length === 0) return;
      const lineStart = blockStart + 1;
      const lineEnd = blockStart + blockLines.length;
      const heading = headings[headings.length - 1];
      const location: SourceLocation = {
        segments: [
          { kind: 'document', value: basename(filePath) },
          ...(heading ? [{ kind: 'heading', value: heading.title }] : []),
          { kind: 'block', value: blockIndex },
          { kind: 'line-range', value: `${lineStart}-${lineEnd}` },
        ],
      };
      const blockContent = blockLines.join('\n');
      const artifactId = stableId(
        'artifact',
        `${revisionId}:${locationKey(location)}:${sha256(blockContent)}`,
      );
      artifacts.push({
        id: artifactId,
        sourceId,
        revisionId,
        parentArtifactId: heading?.artifactId ?? rootId,
        kind: 'content-block',
        location,
        mediaType: 'text/markdown',
        content: blockContent,
        contentHash: sha256(blockContent),
        metadata: sanitizeMetadata({
          headingLevel: heading?.level ?? 0,
          lineStart,
          lineEnd,
          blockIndex,
        }),
      });
      const contextId = stableId('ctx', `${sourceId}:${revisionId}:${artifactId}`);
      const relations = previousContextId
        ? [{ type: 'previous' as const, targetContextId: previousContextId }]
        : [];
      if (previousContextId) {
        const previous = contexts[contexts.length - 1];
        previous.relations.push({ type: 'next', targetContextId: contextId });
      }
      contexts.push({
        schemaVersion: '1.0',
        id: contextId,
        type: 'content-block',
        content: blockContent,
        contentHash: sha256(blockContent),
        provenance: { sourceId, revisionId, artifactId, location },
        relations,
        metadata: sanitizeMetadata({
          headingLevel: heading?.level ?? 0,
          lineStart,
          lineEnd,
          blockIndex,
        }),
      });
      previousContextId = contextId;
      blockIndex += 1;
    };

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (match) {
        flushBlock();
        const level = match[1].length;
        while (headings.length > 0 && headings[headings.length - 1].level >= level) headings.pop();
        const headingLocation: SourceLocation = {
          segments: [
            { kind: 'document', value: basename(filePath) },
            { kind: 'heading', value: match[2] },
            { kind: 'line', value: index + 1 },
          ],
        };
        const headingContent = match[2];
        const artifactId = stableId(
          'artifact',
          `${revisionId}:${locationKey(headingLocation)}:${sha256(headingContent)}`,
        );
        artifacts.push({
          id: artifactId,
          sourceId,
          revisionId,
          parentArtifactId: headings[headings.length - 1]?.artifactId ?? rootId,
          kind: 'heading',
          location: headingLocation,
          mediaType: 'text/markdown',
          content: headingContent,
          contentHash: sha256(headingContent),
          metadata: sanitizeMetadata({ headingLevel: level }),
        });
        headings.push({ artifactId, level, title: headingContent, line: index + 1 });
        blockStart = index + 1;
        blockLines = [];
        continue;
      }
      if (line.trim() === '') {
        flushBlock();
        blockStart = index + 1;
        blockLines = [];
        continue;
      }
      if (blockLines.length === 0) blockStart = index;
      blockLines.push(line);
    }
    flushBlock();
    return { schemaVersion: '1.0', source, revision, artifacts, contexts };
  }
}
