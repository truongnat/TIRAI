// ---------------------------------------------------------------------------
// Excel AI Analyzer – main orchestrator
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SemanticIR, AnalyzerOptions, AnalyzerWarning } from './models.js';
import type { AIProvider } from './provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { SYSTEM_PROMPT, buildUserContent } from './prompts.js';

/**
 * Analyze an Excel context package and produce Semantic IR.
 */
export async function analyzeExcelContext(
  contextDir: string,
  options?: AnalyzerOptions,
): Promise<SemanticIR> {
  const absDir = resolve(contextDir);

  // Load context package
  const manifest = loadManifest(absDir);
  const chunks = loadChunks(absDir, manifest);

  // Filter sheets if requested
  const filteredChunks = options?.sheets
    ? chunks.filter((c) => options.sheets!.includes(c.sheet.name))
    : chunks;

  // Create AI provider
  const provider = createProvider(options);

  // Build prompt content
  const userContent = buildUserContent(filteredChunks);

  // Call AI
  const aiResult = await provider.analyze(SYSTEM_PROMPT, userContent);

  // Validate and enrich the result
  const ir = validateAndEnrich(aiResult, manifest, filteredChunks, provider.name);

  return ir;
}

/**
 * Write Semantic IR to disk.
 */
export function writeSemanticIR(ir: SemanticIR, outputDir: string, pretty: boolean = true): void {
  mkdirSync(outputDir, { recursive: true });
  const content = pretty ? JSON.stringify(ir, null, 2) : JSON.stringify(ir);
  writeFileSync(join(outputDir, 'semantic-ir.json'), content);
}

// ---- Internal helpers -----------------------------------------------------

interface ContextManifest {
  schemaVersion: string;
  source: { file: string; sizeBytes: number };
  stats: { sheets: number; chunks: number; characters: number; estimatedTokens: number };
  sheets: Array<{ index: number; name: string; dimension: string | null; chunks: string[] }>;
  warnings: Array<{ code: string; message: string }>;
}

interface ContextChunkFile {
  schemaVersion: string;
  id: string;
  type: string;
  sheet: { index: number; name: string };
  range: string | null;
  content: string;
  provenance: { sheetIndex: number; sheetName: string; ranges: string[] };
  relations: { previous: string | null; next: string | null; references: unknown[] };
  stats: { cells: number; characters: number; estimatedTokens: number };
}

function loadManifest(dir: string): ContextManifest {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${dir}`);
  }
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

function loadChunks(dir: string, manifest: ContextManifest): ContextChunkFile[] {
  const chunks: ContextChunkFile[] = [];
  const chunksDir = join(dir, 'chunks');

  for (const sheet of manifest.sheets) {
    for (const chunkId of sheet.chunks) {
      const chunkPath = join(chunksDir, `${chunkId}.json`);
      if (!existsSync(chunkPath)) {
        throw new Error(`Chunk file not found: ${chunkPath}`);
      }
      chunks.push(JSON.parse(readFileSync(chunkPath, 'utf-8')));
    }
  }

  return chunks;
}

function createProvider(options?: AnalyzerOptions): AIProvider {
  const apiKey = options?.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Gemini API key required. Set GEMINI_API_KEY environment variable or pass apiKey option.',
    );
  }

  return new GeminiProvider({
    apiKey,
    model: options?.model,
    maxOutputTokens: options?.maxOutputTokens,
  });
}

function validateAndEnrich(
  aiResult: SemanticIR,
  manifest: ContextManifest,
  chunks: ContextChunkFile[],
  providerName: string,
): SemanticIR {
  const warnings: AnalyzerWarning[] = [...(aiResult.warnings || [])];

  // Ensure schema version
  aiResult.schemaVersion = '1.0';

  // Set source metadata
  aiResult.source = {
    file: manifest.source.file,
    sheets: manifest.stats.sheets,
    chunks: chunks.length,
    analyzedAt: 'N/A', // deterministic
    provider: providerName,
  };

  // Validate provenance integrity
  const chunkIds = new Set(chunks.map((c) => c.id));
  for (const prov of aiResult.provenance || []) {
    if (!chunkIds.has(prov.chunkId)) {
      warnings.push({
        code: 'PROVENANCE_CHUNK_MISMATCH',
        message: `Provenance references unknown chunk: ${prov.chunkId}`,
        sheet: prov.sheetName,
      });
    }
  }

  // Validate entity references in relationships
  const entityIds = new Set((aiResult.entities || []).map((e) => e.id));
  for (const rel of aiResult.relationships || []) {
    if (!entityIds.has(rel.fromEntityId)) {
      warnings.push({
        code: 'UNRESOLVED_ENTITY_REF',
        message: `Relationship ${rel.id} references unknown entity: ${rel.fromEntityId}`,
      });
    }
    if (!entityIds.has(rel.toEntityId)) {
      warnings.push({
        code: 'UNRESOLVED_ENTITY_REF',
        message: `Relationship ${rel.id} references unknown entity: ${rel.toEntityId}`,
      });
    }
  }

  aiResult.warnings = warnings;
  return aiResult;
}
