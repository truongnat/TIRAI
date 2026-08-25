// ---------------------------------------------------------------------------
// Context Package loader – reads from disk, validates structure
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SemanticAnalyzerError, SemanticErrorCode } from '../errors.js';
import type { CanonicalContextProvenance, SanitizedMetadataValue, SourceLocation } from 'source-ingestion';

// ---- Input types (mirror context-builder output) -------------------------

export interface ContextManifest {
  schemaVersion: string;
  source: { file: string; sizeBytes: number };
  stats: { sheets: number; chunks: number; characters: number; estimatedTokens: number };
  sheets: SheetIndex[];
  warnings: Array<{ code: string; message: string; sheet?: string }>;
}

export interface SheetIndex {
  index: number;
  name: string;
  dimension: string | null;
  chunks: string[];
}

export interface ContextChunk {
  schemaVersion: string;
  id: string;
  type: string;
  sheet: { index: number; name: string };
  range: string | null;
  content: string;
  provenance: { sheetIndex: number; sheetName: string; ranges: string[]; repeatedHeaders?: string[] };
  relations: { previous: string | null; next: string | null; references: Array<{ type: string; from: string; to: string; detail?: string }> };
  layoutHints: { headerRows?: number[]; borderedRanges?: string[]; mergedRanges?: string[]; hiddenRows?: number[]; hiddenColumns?: number[] } | null;
  stats: { cells: number; characters: number; estimatedTokens: number };
  warnings: Array<{ code: string; message: string }>;
}

/** Source-agnostic in-memory context accepted by the canonical analyzer path. */
export interface CanonicalAnalyzerChunk {
  schemaVersion: '1.0';
  id: string;
  type: string;
  content: string;
  provenance: CanonicalContextProvenance;
  relations: Array<{ type: string; targetContextId: string }>;
  metadata: Record<string, SanitizedMetadataValue>;
  location: SourceLocation;
}

export type AnalyzerContextChunk = ContextChunk | CanonicalAnalyzerChunk;

export interface LoadedContext {
  manifest: ContextManifest;
  chunks: ContextChunk[];
  contextDir: string;
}

/**
 * Load a Context Package from disk.
 *
 * Validates that manifest.json exists, all referenced chunks exist,
 * and the structure is well-formed.
 */
export function loadContextPackage(contextDir: string): LoadedContext {
  const absDir = path.resolve(contextDir);

  // Check directory exists
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    throw new SemanticAnalyzerError(
      SemanticErrorCode.INPUT_NOT_FOUND,
      `Context directory not found: ${absDir}`,
    );
  }

  // Load manifest
  const manifestPath = path.join(absDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new SemanticAnalyzerError(
      SemanticErrorCode.INPUT_NOT_FOUND,
      `manifest.json not found in: ${absDir}`,
    );
  }

  let manifest: ContextManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    throw new SemanticAnalyzerError(
      SemanticErrorCode.INVALID_CONTEXT,
      `Failed to parse manifest.json: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  // Validate manifest structure
  validateManifest(manifest);

  // Load all chunks
  const chunksDir = path.join(absDir, 'chunks');
  const chunks: ContextChunk[] = [];

  for (const sheet of manifest.sheets) {
    for (const chunkId of sheet.chunks) {
      const chunkPath = path.join(chunksDir, `${chunkId}.json`);
      if (!fs.existsSync(chunkPath)) {
        throw new SemanticAnalyzerError(
          SemanticErrorCode.INPUT_NOT_FOUND,
          `Chunk file not found: ${chunkPath} (referenced by sheet "${sheet.name}")`,
        );
      }

      try {
        const chunk = JSON.parse(fs.readFileSync(chunkPath, 'utf-8')) as ContextChunk;
        validateChunk(chunk, chunkId);
        chunks.push(chunk);
      } catch (err) {
        if (err instanceof SemanticAnalyzerError) throw err;
        throw new SemanticAnalyzerError(
          SemanticErrorCode.INVALID_CONTEXT,
          `Failed to parse chunk ${chunkId}: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
    }
  }

  return { manifest, chunks, contextDir: absDir };
}

function validateManifest(manifest: ContextManifest): void {
  if (!manifest.schemaVersion) {
    throw new SemanticAnalyzerError(SemanticErrorCode.INVALID_CONTEXT, 'manifest.json missing schemaVersion');
  }
  if (!manifest.sheets || !Array.isArray(manifest.sheets) || manifest.sheets.length === 0) {
    throw new SemanticAnalyzerError(SemanticErrorCode.INVALID_CONTEXT, 'manifest.json has no sheets');
  }
  for (const sheet of manifest.sheets) {
    if (typeof sheet.index !== 'number' || !sheet.name || !Array.isArray(sheet.chunks)) {
      throw new SemanticAnalyzerError(
        SemanticErrorCode.INVALID_CONTEXT,
        `Invalid sheet entry: ${JSON.stringify(sheet)}`,
      );
    }
  }
}

function validateChunk(chunk: ContextChunk, expectedId: string): void {
  if (chunk.id !== expectedId) {
    throw new SemanticAnalyzerError(
      SemanticErrorCode.INVALID_CONTEXT,
      `Chunk ID mismatch: file expects "${expectedId}", content has "${chunk.id}"`,
    );
  }
  if (!chunk.content || typeof chunk.content !== 'string') {
    throw new SemanticAnalyzerError(
      SemanticErrorCode.INVALID_CONTEXT,
      `Chunk "${expectedId}" has empty or invalid content`,
    );
  }
  if (!chunk.sheet || typeof chunk.sheet.name !== 'string') {
    throw new SemanticAnalyzerError(
      SemanticErrorCode.INVALID_CONTEXT,
      `Chunk "${expectedId}" has invalid sheet reference`,
    );
  }
}
