import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
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

export const URL_CONNECTOR_ID = 'local-url-connector';
export const URL_CONNECTOR_VERSION = '1.0.0';

export class UrlSourceConnector implements SourceConnector {
  readonly id = URL_CONNECTOR_ID;
  readonly version = URL_CONNECTOR_VERSION;
  readonly kind = 'url';

  canOpen(input: LocalSourceInput): boolean {
    if (input.kind && input.kind !== this.kind) return false;
    try {
      const url = new URL(input.path);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async open(input: LocalSourceInput): Promise<CanonicalSourceDocument> {
    if (!this.canOpen(input)) {
      throw new SourceIngestionError('UNSUPPORTED_SOURCE', `URL connector does not support "${input.path}".`);
    }
    const urlStr = input.path;
    let html: string;
    let byteLength = 0;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(urlStr, { signal: controller.signal, headers: { 'User-Agent': 'TIRAI/1.0' } });
      clearTimeout(timeout);
      if (!res.ok) {
        throw new SourceIngestionError('INVALID_SOURCE', `Failed to fetch URL "${urlStr}": ${res.status} ${res.statusText}`);
      }
      html = await res.text();
      byteLength = Buffer.byteLength(html, 'utf8');
    } catch (error) {
      if (error instanceof SourceIngestionError) throw error;
      throw new SourceIngestionError(
        'INVALID_SOURCE',
        `Failed to fetch URL "${urlStr}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const sourceHash = sha256(html);
    const sourceId = stableId('src', `${this.kind}:${urlStr}`);
    const revisionId = stableId('rev', `${sourceId}:${sourceHash}`);
    const displayName = (() => {
      try {
        const u = new URL(urlStr);
        return u.hostname + u.pathname;
      } catch {
        return basename(urlStr);
      }
    })();
    const descriptor = {
      id: sourceId,
      kind: this.kind,
      displayName,
      connectorId: this.id,
      connectorVersion: this.version,
    };
    const revision = { id: revisionId, contentHash: sourceHash, version: sourceHash };

    const { sections } = await parseHtml(html, urlStr);

    return buildUrlCanonicalDocument({
      sourceId,
      revisionId,
      sourceHash,
      displayName,
      byteLength,
      url: urlStr,
      html,
      sections,
      descriptor,
      revision,
    });
  }
}

async function parseHtml(html: string, url: string): Promise<{ sections: Array<{ heading: string; content: string }> }> {
  try {
    const cheerio: any = await import('cheerio');
    const $ = cheerio.load(html);
    // Remove script/style
    $('script, style, noscript').remove();
    const sections: Array<{ heading: string; content: string }> = [];
    // Try to find headings and their following content
    const headings = $('h1, h2, h3').toArray();
    if (headings.length > 0) {
      for (const elem of headings) {
        const heading = $(elem).text().trim().replace(/\s+/g, ' ');
        let content = '';
        let next = $(elem).next();
        while (next.length && !next.is('h1, h2, h3')) {
          const text = next.text().trim().replace(/\s+/g, ' ');
          if (text) content += (content ? '\n' : '') + text;
          next = next.next();
        }
        if (heading || content) {
          sections.push({ heading: heading || 'Section', content: content || heading });
        }
      }
    }
    if (sections.length === 0) {
      // Fallback: whole body text chunked
      const bodyText = $('body').text().trim().replace(/\s+/g, ' ');
      if (bodyText) {
        sections.push({ heading: 'Document', content: bodyText });
      } else {
        const text = $.text().trim().replace(/\s+/g, ' ');
        if (text) sections.push({ heading: 'Document', content: text });
      }
    }
    return { sections };
  } catch (e) {
    throw new SourceIngestionError('INVALID_SOURCE', `Failed to parse HTML from "${url}": ${e instanceof Error ? e.message : String(e)}`);
  }
}

interface UrlCanonicalInput {
  sourceId: string;
  revisionId: string;
  sourceHash: string;
  displayName: string;
  byteLength: number;
  url: string;
  html: string;
  sections: Array<{ heading: string; content: string }>;
  descriptor: CanonicalSourceDocument['source'];
  revision: CanonicalSourceDocument['revision'];
}

function buildUrlCanonicalDocument(input: UrlCanonicalInput): CanonicalSourceDocument {
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
      mediaType: 'text/html',
      content: input.html.slice(0, 10000), // Store truncated HTML for reference
      contentHash: input.sourceHash,
      metadata: sanitizeMetadata({
        displayName: input.displayName,
        url: input.url,
        byteLength: input.byteLength,
        sectionCount: input.sections.length,
      }),
    },
  ];

  const contexts: CanonicalContextChunk[] = [];

  for (let idx = 0; idx < input.sections.length; idx++) {
    const sec = input.sections[idx]!;
    const secLocation: SourceLocation = {
      segments: [...rootLocation.segments, { kind: 'section', value: sec.heading.slice(0, 50) }],
    };
    const secHash = sha256(`section:${idx}|${sec.heading}`);
    const secArtifactId = stableArtifactId(input.sourceId, input.revisionId, 'section', secLocation, secHash);
    artifacts.push({
      id: secArtifactId,
      sourceId: input.sourceId,
      revisionId: input.revisionId,
      parentArtifactId: rootArtifactId,
      kind: 'section',
      location: secLocation,
      mediaType: 'text/html',
      content: sec.heading,
      contentHash: secHash,
      metadata: sanitizeMetadata({ heading: sec.heading }),
    });

    const content = `${sec.heading}\n${sec.content}`.trim();
    const chunks = content.length <= 1000 ? [content] : splitByChunkSize(content, 1000);
    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunkText = chunks[chunkIdx]!.trim();
      if (!chunkText) continue;
      const chunkLocation: SourceLocation = {
        segments: [...secLocation.segments, { kind: 'section-content', value: String(chunkIdx) }],
      };
      const contentHash = sha256(chunkText);
      const artifactId = stableArtifactId(input.sourceId, input.revisionId, 'section-content', chunkLocation, contentHash);
      artifacts.push({
        id: artifactId,
        sourceId: input.sourceId,
        revisionId: input.revisionId,
        parentArtifactId: secArtifactId,
        kind: 'section-content',
        location: chunkLocation,
        mediaType: 'text/plain',
        content: chunkText,
        contentHash,
        metadata: sanitizeMetadata({ sectionIndex: idx, chunkIndex: chunkIdx }),
      });
      contexts.push({
        schemaVersion: '1.0',
        id: stableId('ctx', `${input.sourceId}:${input.revisionId}:${artifactId}`),
        type: 'section-content',
        content: chunkText,
        contentHash,
        provenance: {
          sourceId: input.sourceId,
          revisionId: input.revisionId,
          artifactId,
          location: chunkLocation,
        },
        relations: [],
        metadata: sanitizeMetadata({ sectionIndex: idx, chunkIndex: chunkIdx }),
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
