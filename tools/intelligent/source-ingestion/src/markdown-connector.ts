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

export const MARKDOWN_CONNECTOR_ID = 'local-markdown-connector';
export const MARKDOWN_CONNECTOR_VERSION = '1.0.0';

export class MarkdownSourceConnector implements SourceConnector {
  readonly id = MARKDOWN_CONNECTOR_ID;
  readonly version = MARKDOWN_CONNECTOR_VERSION;
  readonly kind = 'markdown';

  canOpen(input: LocalSourceInput): boolean {
    if (input.kind && input.kind !== this.kind) return false;
    const extension = extname(input.path).toLowerCase();
    return extension === '.md' || extension === '.markdown';
  }

  async open(input: LocalSourceInput): Promise<CanonicalSourceDocument> {
    if (!this.canOpen(input)) {
      throw new SourceIngestionError('UNSUPPORTED_SOURCE', `Markdown connector does not support "${input.path}".`);
    }
    const sourcePath = resolve(input.path);
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
        connectorId: MARKDOWN_CONNECTOR_ID,
        connectorVersion: MARKDOWN_CONNECTOR_VERSION,
      };
      const revision = { id: revisionId, contentHash: sourceHash, version: sourceHash };
      return buildMarkdownDocument(raw, {
        sourceId,
        revisionId,
        sourceHash,
        byteLength: sourceStats.size,
        displayName: basename(sourcePath),
        descriptor,
        revision,
      });
    } catch (error) {
      if (error instanceof SourceIngestionError) throw error;
      throw new SourceIngestionError(
        'INVALID_SOURCE',
        `Failed to ingest Markdown source "${basename(sourcePath)}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

interface MarkdownInput {
  sourceId: string;
  revisionId: string;
  sourceHash: string;
  byteLength: number;
  displayName: string;
  descriptor: CanonicalSourceDocument['source'];
  revision: CanonicalSourceDocument['revision'];
}

interface Heading {
  level: number;
  text: string;
  line: number;
  artifactId: string;
}

function buildMarkdownDocument(raw: string, input: MarkdownInput): CanonicalSourceDocument {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const rootLocation: SourceLocation = { segments: [{ kind: 'document', value: input.displayName }] };
  const rootArtifactId = stableArtifactId(input, 'document', rootLocation, input.sourceHash);
  const artifacts: SourceArtifact[] = [{
    id: rootArtifactId,
    sourceId: input.sourceId,
    revisionId: input.revisionId,
    kind: 'document',
    location: rootLocation,
    mediaType: 'text/markdown',
    content: raw,
    contentHash: input.sourceHash,
    metadata: sanitizeMetadata({
      displayName: input.displayName,
      extension: extname(input.displayName).toLowerCase(),
      mediaType: 'text/markdown',
      byteLength: input.byteLength,
    }),
  }];

  const contexts: CanonicalContextChunk[] = [];
  const headings: Heading[] = [];
  let activeBlock: number[] = [];
  let blockIndex = 0;

  const flushBlock = (endLine: number): void => {
    if (activeBlock.length === 0) return;
    const startLine = activeBlock[0]!;
    const blockLines = lines.slice(startLine - 1, endLine);
    const content = blockLines.join('\n').trim();
    if (!content) {
      activeBlock = [];
      return;
    }
    const parent = headings[headings.length - 1];
    const location: SourceLocation = {
      segments: [
        ...rootLocation.segments,
        ...(parent ? [{ kind: 'heading', value: parent.text }] : []),
        { kind: 'block', value: blockIndex },
        { kind: 'line-range', value: `${startLine}-${endLine}` },
      ],
    };
    const contentHash = sha256(content);
    const artifactId = stableArtifactId(input, 'content-block', location, contentHash);
    artifacts.push({
      id: artifactId,
      sourceId: input.sourceId,
      revisionId: input.revisionId,
      parentArtifactId: parent?.artifactId ?? rootArtifactId,
      kind: 'content-block',
      location,
      mediaType: 'text/markdown',
      content,
      contentHash,
      metadata: sanitizeMetadata({
        blockIndex,
        lineStart: startLine,
        lineEnd: endLine,
      }),
    });
    contexts.push({
      schemaVersion: '1.0',
      id: stableId('ctx', `${input.sourceId}:${input.revisionId}:${artifactId}`),
      type: 'content-block',
      content,
      contentHash,
      provenance: {
        sourceId: input.sourceId,
        revisionId: input.revisionId,
        artifactId,
        location,
      },
      parentContextId: parent ? contexts.find((context) => context.provenance.artifactId === parent.artifactId)?.id : undefined,
      relations: [],
      metadata: sanitizeMetadata({
        blockIndex,
        lineStart: startLine,
        lineEnd: endLine,
      }),
    });
    blockIndex++;
    activeBlock = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index]!;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      flushBlock(lineNumber - 1);
      const level = match[1]!.length;
      while (headings.length > 0 && headings[headings.length - 1]!.level >= level) headings.pop();
      const parent = headings[headings.length - 1];
      const location: SourceLocation = {
        segments: [
          ...rootLocation.segments,
          ...(parent ? [{ kind: 'heading', value: parent.text }] : []),
          { kind: 'heading', value: match[2]! },
          { kind: 'line-range', value: `${lineNumber}-${lineNumber}` },
        ],
      };
      const contentHash = sha256(line);
      const artifactId = stableArtifactId(input, 'heading', location, contentHash);
      artifacts.push({
        id: artifactId,
        sourceId: input.sourceId,
        revisionId: input.revisionId,
        parentArtifactId: parent?.artifactId ?? rootArtifactId,
        kind: 'heading',
        location,
        mediaType: 'text/markdown',
        content: line,
        contentHash,
        metadata: sanitizeMetadata({ headingLevel: level, lineStart: lineNumber, lineEnd: lineNumber }),
      });
      headings.push({ level, text: match[2]!, line: lineNumber, artifactId });
      continue;
    }
    if (line.trim() === '') {
      flushBlock(lineNumber - 1);
    } else if (activeBlock.length === 0) {
      activeBlock = [lineNumber];
    }
  }
  flushBlock(lines.length);

  for (const [index, context] of contexts.entries()) {
    if (index > 0) context.relations.push({ type: 'continuation-previous', targetContextId: contexts[index - 1]!.id });
    if (index + 1 < contexts.length) context.relations.push({ type: 'continuation-next', targetContextId: contexts[index + 1]!.id });
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
  input: MarkdownInput,
  kind: string,
  location: SourceLocation,
  contentHash: string,
): string {
  return stableId('artifact', `${input.sourceId}:${input.revisionId}:${kind}:${locationKey(location)}:${contentHash}`);
}
