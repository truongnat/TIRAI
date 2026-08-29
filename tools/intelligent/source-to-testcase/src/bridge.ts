// ---------------------------------------------------------------------------
// Bridge: CanonicalSourceDocument -> semantic-analyzer context package format
// ---------------------------------------------------------------------------
// The semantic analyzer consumes a directory with `manifest.json` and
// `chunks/<id>.json`. The Excel (and any) connector emits a
// `CanonicalSourceDocument` whose `contexts` carry exactly the fields the
// semantic chunk model expects (content, sheet, provenance, relations).
// This adapter writes that directory with NO source-specific branching:
// it is generic over the canonical document, so the same bridge works for
// any future connector that emits a CanonicalSourceDocument.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CanonicalSourceDocument, CanonicalContextChunk } from 'source-ingestion';

export interface SemanticContextWriteResult {
  dir: string;
  chunkCount: number;
  sheetCount: number;
  characters: number;
}

interface SemanticChunk {
  schemaVersion: '1.0';
  id: string;
  type: string;
  sheet: { index: number; name: string };
  range: string | null;
  content: string;
  provenance: { sheetIndex: number; sheetName: string; ranges: string[]; repeatedHeaders?: string[] };
  relations: { previous: string | null; next: string | null; references: Array<{ type: string; from: string; to: string; detail?: string }> };
  layoutHints: null;
  stats: { cells: number; characters: number; estimatedTokens: number };
  warnings: Array<{ code: string; message: string }>;
}

function toInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapRelations(ctx: CanonicalContextChunk): SemanticChunk['relations'] {
  let previous: string | null = null;
  let next: string | null = null;
  for (const rel of ctx.relations ?? []) {
    if (rel.type === 'continuation-previous' && typeof rel.targetContextId === 'string') {
      previous = rel.targetContextId;
    } else if (rel.type === 'continuation-next' && typeof rel.targetContextId === 'string') {
      next = rel.targetContextId;
    }
  }
  return { previous, next, references: [] };
}

export function writeSemanticContextPackage(doc: CanonicalSourceDocument, dir: string): SemanticContextWriteResult {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'chunks'), { recursive: true });

  const sheets = new Map<number, { index: number; name: string; dimension: string | null; chunks: string[] }>();
  let characters = 0;
  let estimatedTokens = 0;

  for (const ctx of doc.contexts) {
    const sheetIndex = toInt(ctx.metadata?.sheetIndex, 0);
    const sheetName = String(ctx.metadata?.sheetName ?? 'Sheet1');
    if (!sheets.has(sheetIndex)) {
      sheets.set(sheetIndex, { index: sheetIndex, name: sheetName, dimension: null, chunks: [] });
    }
    const sheetEntry = sheets.get(sheetIndex)!;
    sheetEntry.chunks.push(ctx.id);

    const range = ctx.metadata?.range ? String(ctx.metadata.range) : null;
    if (range && !sheetEntry.dimension) sheetEntry.dimension = range;

    const chunk: SemanticChunk = {
      schemaVersion: '1.0',
      id: ctx.id,
      type: ctx.type,
      sheet: { index: sheetIndex, name: sheetName },
      range,
      content: ctx.content,
      provenance: {
        sheetIndex,
        sheetName,
        ranges: range ? [range] : [],
      },
      relations: mapRelations(ctx),
      layoutHints: null,
      stats: {
        cells: 0,
        characters: ctx.content.length,
        estimatedTokens: Math.ceil(ctx.content.length / 4),
      },
      warnings: [],
    };

    fs.writeFileSync(path.join(dir, 'chunks', `${ctx.id}.json`), JSON.stringify(chunk, null, 2), 'utf8');
    characters += ctx.content.length;
    estimatedTokens += chunk.stats.estimatedTokens;
  }

  const sheetList = [...sheets.values()].sort((a, b) => a.index - b.index);
  const manifest = {
    schemaVersion: '1.0',
    source: { file: doc.source.displayName, sizeBytes: 0 },
    stats: {
      sheets: sheetList.length,
      chunks: doc.contexts.length,
      characters,
      estimatedTokens,
    },
    sheets: sheetList,
    warnings: [],
  };

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  return { dir, chunkCount: doc.contexts.length, sheetCount: sheetList.length, characters };
}
